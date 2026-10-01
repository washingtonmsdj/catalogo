#!/usr/bin/env python3
"""Build an R2-ready media bundle from the reviewed ingestion manifest.

The source catalog is read-only. Only records marked OK + canonical are
published. Variants are generated without upscaling and grouped by the stable
hierarchical model key produced by ingest_catalog.py.

Every media object and gallery manifest gets a deterministic/content-addressed
key so already published data can be cached for a long time and skipped by the
incremental R2 publisher.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import re
import shutil
import sys
import unicodedata
from collections import Counter, defaultdict
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

from PIL import Image, ImageOps

VARIANTS = {
    "thumb": (360, 80),
    "card": (800, 84),
    "detail": (1600, 88),
}


def stable_id(prefix: str, value: str, length: int = 20) -> str:
    digest = hashlib.sha256(value.encode("utf-8")).hexdigest()[:length]
    return f"{prefix}_{digest}"


def slugify(value: str) -> str:
    normalized = unicodedata.normalize("NFKD", value)
    ascii_value = normalized.encode("ascii", "ignore").decode("ascii").lower()
    slug = re.sub(r"[^a-z0-9]+", "-", ascii_value).strip("-")
    return slug or "modelo"


GROUPING_FOLDERS = {
    "Animes & Desenhos": {"Animes", "Clássicos", "Outros"},
    "Marvel & DC": {"Marvel", "DC"},
}
DEFAULT_TAXONOMY_CONFIG = Path(__file__).resolve().parents[1] / "config" / "catalog-taxonomy.json"


def humanize_stem(value: str) -> str:
    text = re.sub(r"[-_]+", " ", value).strip()
    return text[:1].upper() + text[1:] if text else "Modelo"


def franchise_index(hierarchy: list[str]) -> int:
    if len(hierarchy) < 2:
        return 0
    category = hierarchy[0]
    second = hierarchy[1]
    if category in GROUPING_FOLDERS and second in GROUPING_FOLDERS[category] and len(hierarchy) > 2:
        return 2
    if category == "Filmes & Séries" and re.match(r"^\d{2}\s*-\s*", second) and len(hierarchy) > 2:
        return 2
    if category == "Games" and second == "00 - Fliperama" and len(hierarchy) > 2:
        return 2
    return 1


def validate_taxonomy_config(data: dict, config_path: Path) -> None:
    if data.get("version") != 1 or not isinstance(data.get("franchises"), dict):
        raise RuntimeError(f"configuração de taxonomia inválida: {config_path}")
    for franchise_key, rule in data["franchises"].items():
        if not isinstance(franchise_key, str) or franchise_key.count("/") != 1 or not all(part.strip() for part in franchise_key.split("/")):
            raise RuntimeError(f"chave de franquia inválida em {config_path}: {franchise_key!r}")
        if not isinstance(rule, dict):
            raise RuntimeError(f"regra de franquia inválida em {config_path}: {franchise_key}")
        overrides = rule.get("pathOverrides", {})
        if not isinstance(overrides, dict):
            raise RuntimeError(f"pathOverrides inválido em {config_path}: {franchise_key}")
        for source_key, replacement in overrides.items():
            if not isinstance(source_key, str) or not source_key.strip() or any(not part.strip() for part in source_key.split(" / ")):
                raise RuntimeError(f"caminho fonte inválido em {config_path}: {franchise_key} -> {source_key!r}")
            if not isinstance(replacement, list) or not replacement:
                raise RuntimeError(f"caminho público inválido em {config_path}: {franchise_key} -> {source_key}")
            for part in replacement:
                if not isinstance(part, str) or not part.strip() or part.strip() in {".", ".."} or "/" in part or "\\" in part:
                    raise RuntimeError(f"segmento público inválido em {config_path}: {franchise_key} -> {source_key}")


def load_taxonomy_config(path: Path | None = None) -> dict:
    config_path = path or DEFAULT_TAXONOMY_CONFIG
    if not config_path.is_file():
        return {"version": 1, "franchises": {}}
    try:
        data = json.loads(config_path.read_text(encoding="utf-8"))
    except json.JSONDecodeError as exc:
        raise RuntimeError(f"JSON de taxonomia inválido: {config_path}: {exc}") from exc
    validate_taxonomy_config(data, config_path)
    return data


def public_folder_path(category_slug: str, franchise_slug: str, source_parts: list[str], taxonomy: dict) -> list[str]:
    rule = taxonomy.get("franchises", {}).get(f"{category_slug}/{franchise_slug}", {})
    overrides = rule.get("pathOverrides", {}) if isinstance(rule, dict) else {}
    source_key = " / ".join(source_parts)
    replacement = overrides.get(source_key)
    if replacement is None:
        return source_parts
    if not isinstance(replacement, list) or not replacement or not all(isinstance(item, str) and item.strip() for item in replacement):
        raise RuntimeError(f"pathOverride inválido para {category_slug}/{franchise_slug}: {source_key}")
    return [item.strip() for item in replacement]


def read_manifest(path: Path) -> list[dict]:
    with path.open("r", encoding="utf-8") as handle:
        return [json.loads(line) for line in handle if line.strip()]


def render_variants(source: Path, r2_root: Path, base_key: str) -> tuple[dict[str, str], dict[str, dict]]:
    variants: dict[str, str] = {}
    variant_meta: dict[str, dict] = {}
    with Image.open(source) as opened:
        base_image = ImageOps.exif_transpose(opened).convert("RGB")
        for variant, (max_side, quality) in VARIANTS.items():
            key = f"{base_key}/{variant}.webp"
            destination = r2_root / key
            destination.parent.mkdir(parents=True, exist_ok=True)
            image = base_image.copy()
            image.thumbnail((max_side, max_side), Image.Resampling.LANCZOS)
            width, height = image.size
            image.save(destination, "WEBP", quality=quality, method=6, optimize=True)
            variants[variant] = key
            variant_meta[variant] = {
                "width": width,
                "height": height,
                "bytes": destination.stat().st_size,
                "mime": "image/webp",
            }
    return variants, variant_meta


def copy_original(source: Path, destination: Path) -> int:
    destination.parent.mkdir(parents=True, exist_ok=True)
    shutil.copy2(source, destination)
    return destination.stat().st_size


def gallery_identity(payload: dict) -> tuple[str, int]:
    encoded = json.dumps(payload, ensure_ascii=False, sort_keys=True, separators=(",", ":")).encode("utf-8")
    digest = hashlib.sha256(encoded).hexdigest()
    # 48 bits remain safely below JavaScript's maximum exact integer and are
    # enough for cache/version invalidation at this catalog scale.
    version = int(digest[:12], 16)
    return digest, version


def model_metadata(identity_key: str, hierarchy_key: str, source_path: str, slug_collisions: Counter[str], taxonomy: dict, audited_public: bool = False) -> dict:
    hierarchy = hierarchy_key.split(" / ")
    model_id = stable_id("mdl", identity_key)
    category_name = hierarchy[0] if hierarchy else "Outros"
    franchise_pos = franchise_index(hierarchy)
    franchise_name = hierarchy[franchise_pos] if hierarchy else category_name
    source_stem = Path(source_path).stem
    display_name = humanize_stem(source_stem) if audited_public else (hierarchy[-1] if hierarchy else humanize_stem(source_stem))
    source_collection_parts = hierarchy[franchise_pos + 1:-1] if not audited_public else hierarchy[franchise_pos + 1:]
    category_slug = slugify(category_name)
    franchise_slug = slugify(franchise_name)
    collection_parts = public_folder_path(category_slug, franchise_slug, source_collection_parts, taxonomy) if audited_public else source_collection_parts
    collection = " / ".join(collection_parts)

    clean_parts = [franchise_name, display_name] if audited_public else [franchise_name, *collection_parts, display_name]
    base_slug = slugify(" ".join(clean_parts) or display_name)
    model_slug = base_slug
    if slug_collisions[base_slug] > 1:
        model_slug = f"{base_slug}-{model_id.split('_', 1)[1][:10]}"

    code_hash = hashlib.sha256(identity_key.encode("utf-8")).hexdigest()[:12].upper()
    code = f"TS-{code_hash}"
    search_text = " ".join(dict.fromkeys([*hierarchy, *collection_parts, display_name, code])).casefold()

    return {
        "id": model_id,
        "slug": model_slug,
        "code": code,
        "sourceHierarchy": hierarchy,
        "categoryName": category_name,
        "categorySlug": category_slug,
        "franchiseName": franchise_name,
        "franchiseSlug": franchise_slug,
        "displayName": display_name,
        "collection": collection,
        "folderPath": collection_parts,
        "folderPathKey": "/".join(slugify(part) for part in collection_parts),
        "searchText": search_text,
    }


def build_model_bundle(
    identity_key: str,
    rows: list[dict],
    source_root: Path,
    r2_root: Path,
    slug_collisions: Counter[str],
    taxonomy: dict,
    include_original: bool,
) -> tuple[dict, int, int]:
    rows = sorted(
        rows,
        key=lambda row: (
            float(row.get("quality_score") or 0),
            int(row.get("width") or 0),
            int(row.get("height") or 0),
        ),
        reverse=True,
    )
    metadata = model_metadata(
        identity_key,
        str(rows[0]["model_key"]),
        str(rows[0]["path"]),
        slug_collisions,
        taxonomy,
        bool(rows[0].get("public_model_key")),
    )
    model_id = metadata["id"]
    gallery_images = []
    variant_files = 0

    for position, row in enumerate(rows):
        source = source_root / str(row["path"])
        if not source.is_file():
            raise FileNotFoundError(f"imagem ausente: {source}")
        sha = str(row["sha256"])
        image_id = stable_id("img", sha)
        base_key = f"media/{model_id}/{image_id}"
        variants, variant_meta = render_variants(source, r2_root, base_key)
        variant_files += len(variants)

        if include_original:
            suffix = source.suffix.lower() or ".bin"
            key = f"{base_key}/original{suffix}"
            byte_count = copy_original(source, r2_root / key)
            variants["original"] = key
            variant_meta["original"] = {
                "width": row.get("width"),
                "height": row.get("height"),
                "bytes": byte_count,
                "mime": f"image/{suffix.lstrip('.').replace('jpg', 'jpeg')}",
            }
            variant_files += 1

        gallery_images.append({
            "id": image_id,
            "role": "cover" if position == 0 else "gallery",
            "width": row.get("width"),
            "height": row.get("height"),
            "bytes": row.get("size"),
            "mime": f"image/{source.suffix.lower().lstrip('.').replace('jpg', 'jpeg')}",
            "qualityScore": row.get("quality_score"),
            "sourceSha256": sha,
            "variantKeys": variants,
            "variants": variant_meta,
        })

    identity_payload = {
        "modelId": model_id,
        "sourceHierarchy": metadata["sourceHierarchy"],
        "images": gallery_images,
    }
    gallery_digest, gallery_version = gallery_identity(identity_payload)
    gallery_key = f"gallery/{model_id}/{gallery_digest[:24]}.json"
    gallery = {
        "version": gallery_version,
        **identity_payload,
        "generatedBy": "tools/build_media_bundle.py",
    }
    gallery_path = r2_root / gallery_key
    gallery_path.parent.mkdir(parents=True, exist_ok=True)
    gallery_path.write_text(
        json.dumps(gallery, ensure_ascii=False, separators=(",", ":")) + "\n",
        encoding="utf-8",
    )

    cover_key = gallery_images[0]["variantKeys"]["card"] if gallery_images else None
    model_entry = {
        **metadata,
        "imageCount": len(gallery_images),
        "coverStorageKey": cover_key,
        "galleryManifestKey": gallery_key,
        "galleryVersion": gallery_version,
    }
    return model_entry, len(gallery_images), variant_files


def build_bundle(source_root: Path, manifest_path: Path, output: Path, include_original: bool, taxonomy_config: Path | None = None, workers: int = 4) -> dict:
    taxonomy = load_taxonomy_config(taxonomy_config)
    records = [row for row in read_manifest(manifest_path) if row.get("status") == "OK" and row.get("canonical") is True]
    by_model: dict[str, list[dict]] = defaultdict(list)
    for row in records:
        identity_key = str(row.get("public_model_key") or row["model_key"])
        by_model[identity_key].append(row)

    model_keys = sorted(by_model, key=str.casefold)
    base_slugs = []
    for identity_key in model_keys:
        row = by_model[identity_key][0]
        hierarchy = str(row["model_key"]).split(" / ")
        franchise_pos = franchise_index(hierarchy)
        franchise_name = hierarchy[franchise_pos] if hierarchy else "Outros"
        audited_public = bool(row.get("public_model_key"))
        source_collection_parts = hierarchy[franchise_pos + 1:] if audited_public else hierarchy[franchise_pos + 1:-1]
        category_name = hierarchy[0] if hierarchy else "Outros"
        category_slug = slugify(category_name)
        franchise_slug = slugify(franchise_name)
        collection_parts = public_folder_path(category_slug, franchise_slug, source_collection_parts, taxonomy) if audited_public else source_collection_parts
        display_name = humanize_stem(Path(str(row["path"])).stem) if audited_public else (hierarchy[-1] if hierarchy else "Modelo")
        slug_parts = [franchise_name, display_name] if audited_public else [franchise_name, *collection_parts, display_name]
        base_slugs.append(slugify(" ".join(slug_parts)))
    slug_collisions = Counter(base_slugs)

    r2_root = output / "r2"
    model_index = output / "models.jsonl"
    output.mkdir(parents=True, exist_ok=True)
    published_images = 0
    variant_files = 0

    if workers < 1 or workers > 16:
        raise ValueError("workers deve ficar entre 1 e 16")

    def build_one(identity_key: str) -> tuple[dict, int, int]:
        return build_model_bundle(
            identity_key=identity_key,
            rows=by_model[identity_key],
            source_root=source_root,
            r2_root=r2_root,
            slug_collisions=slug_collisions,
            taxonomy=taxonomy,
            include_original=include_original,
        )

    with model_index.open("w", encoding="utf-8") as index_handle:
        with ThreadPoolExecutor(max_workers=workers, thread_name_prefix="media-build") as executor:
            for model_entry, image_count, model_variant_files in executor.map(build_one, model_keys):
                index_handle.write(json.dumps(model_entry, ensure_ascii=False) + "\n")
                published_images += image_count
                variant_files += model_variant_files

    summary = {
        "models": len(by_model),
        "canonicalImages": published_images,
        "variantFiles": variant_files,
        "galleryManifests": len(by_model),
        "includeOriginal": include_original,
        "r2Root": str(r2_root),
    }
    (output / "publish-summary.json").write_text(
        json.dumps(summary, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )
    return summary


def main() -> int:
    parser = argparse.ArgumentParser(description="Gera variantes WebP e manifestos prontos para o R2.")
    parser.add_argument("source", type=Path, help="raiz do catálogo original")
    parser.add_argument("manifest", type=Path, help="manifest.jsonl gerado por ingest_catalog.py")
    parser.add_argument("--output", type=Path, default=Path(".publish-bundle"))
    parser.add_argument("--include-original", action="store_true", help="inclui cópia do original no bundle R2")
    parser.add_argument("--taxonomy-config", type=Path, default=DEFAULT_TAXONOMY_CONFIG, help="regras explícitas de pastas públicas")
    parser.add_argument("--workers", type=int, default=4, help="modelos processados em paralelo; padrão: 4")
    args = parser.parse_args()

    if not args.source.is_dir():
        parser.error(f"pasta fonte não encontrada: {args.source}")
    if not args.manifest.is_file():
        parser.error(f"manifesto não encontrado: {args.manifest}")

    summary = build_bundle(source_root=args.source.resolve(), manifest_path=args.manifest.resolve(), output=args.output.resolve(), include_original=args.include_original, taxonomy_config=args.taxonomy_config.resolve(), workers=args.workers)
    print(json.dumps(summary, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    sys.exit(main())
