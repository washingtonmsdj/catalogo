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


def read_manifest(path: Path) -> list[dict]:
    with path.open("r", encoding="utf-8") as handle:
        return [json.loads(line) for line in handle if line.strip()]


def render_variant(source: Path, destination: Path, max_side: int, quality: int) -> tuple[int, int, int]:
    destination.parent.mkdir(parents=True, exist_ok=True)
    with Image.open(source) as opened:
        image = ImageOps.exif_transpose(opened).convert("RGB")
        image.thumbnail((max_side, max_side), Image.Resampling.LANCZOS)
        width, height = image.size
        image.save(destination, "WEBP", quality=quality, method=6, optimize=True)
    return width, height, destination.stat().st_size


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


def model_metadata(model_key: str, slug_collisions: Counter[str]) -> dict:
    hierarchy = model_key.split(" / ")
    model_id = stable_id("mdl", model_key)
    category_name = hierarchy[0] if hierarchy else "Outros"
    franchise_name = hierarchy[1] if len(hierarchy) > 1 else category_name
    display_name = hierarchy[-1] if hierarchy else model_key
    collection = " / ".join(hierarchy[2:-1]) if len(hierarchy) > 3 else ""

    clean_parts = hierarchy[1:] if len(hierarchy) > 1 else hierarchy
    base_slug = slugify(" ".join(clean_parts) or display_name)
    model_slug = base_slug
    if slug_collisions[base_slug] > 1:
        model_slug = f"{base_slug}-{model_id.split('_', 1)[1][:10]}"

    code_hash = hashlib.sha256(model_key.encode("utf-8")).hexdigest()[:12].upper()
    code = f"TS-{code_hash}"
    search_text = " ".join(dict.fromkeys([*hierarchy, display_name, code])).casefold()

    return {
        "id": model_id,
        "slug": model_slug,
        "code": code,
        "sourceHierarchy": hierarchy,
        "categoryName": category_name,
        "categorySlug": slugify(category_name),
        "franchiseName": franchise_name,
        "franchiseSlug": slugify(franchise_name),
        "displayName": display_name,
        "collection": collection,
        "searchText": search_text,
    }


def build_bundle(source_root: Path, manifest_path: Path, output: Path, include_original: bool) -> dict:
    records = [row for row in read_manifest(manifest_path) if row.get("status") == "OK" and row.get("canonical") is True]
    by_model: dict[str, list[dict]] = defaultdict(list)
    for row in records:
        by_model[str(row["model_key"])].append(row)

    model_keys = sorted(by_model, key=str.casefold)
    base_slugs = []
    for model_key in model_keys:
        hierarchy = model_key.split(" / ")
        clean_parts = hierarchy[1:] if len(hierarchy) > 1 else hierarchy
        base_slugs.append(slugify(" ".join(clean_parts) or hierarchy[-1]))
    slug_collisions = Counter(base_slugs)

    r2_root = output / "r2"
    model_index = output / "models.jsonl"
    output.mkdir(parents=True, exist_ok=True)
    published_images = 0
    variant_files = 0

    with model_index.open("w", encoding="utf-8") as index_handle:
        for model_key in model_keys:
            rows = sorted(
                by_model[model_key],
                key=lambda row: (
                    float(row.get("quality_score") or 0),
                    int(row.get("width") or 0),
                    int(row.get("height") or 0),
                ),
                reverse=True,
            )
            metadata = model_metadata(model_key, slug_collisions)
            model_id = metadata["id"]
            gallery_images = []

            for position, row in enumerate(rows):
                source = source_root / str(row["path"])
                if not source.is_file():
                    raise FileNotFoundError(f"imagem ausente: {source}")
                sha = str(row["sha256"])
                image_id = stable_id("img", sha)
                base_key = f"media/{model_id}/{image_id}"
                variants: dict[str, str] = {}
                variant_meta: dict[str, dict] = {}

                for variant, (max_side, quality) in VARIANTS.items():
                    key = f"{base_key}/{variant}.webp"
                    width, height, byte_count = render_variant(source, r2_root / key, max_side, quality)
                    variants[variant] = key
                    variant_meta[variant] = {
                        "width": width,
                        "height": height,
                        "bytes": byte_count,
                        "mime": "image/webp",
                    }
                    variant_files += 1

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
                published_images += 1

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
            index_handle.write(json.dumps({
                **metadata,
                "imageCount": len(gallery_images),
                "coverStorageKey": cover_key,
                "galleryManifestKey": gallery_key,
                "galleryVersion": gallery_version,
            }, ensure_ascii=False) + "\n")

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
    args = parser.parse_args()

    if not args.source.is_dir():
        parser.error(f"pasta fonte não encontrada: {args.source}")
    if not args.manifest.is_file():
        parser.error(f"manifesto não encontrado: {args.manifest}")

    summary = build_bundle(source_root=args.source.resolve(), manifest_path=args.manifest.resolve(), output=args.output.resolve(), include_original=args.include_original)
    print(json.dumps(summary, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    sys.exit(main())
