#!/usr/bin/env python3
"""Publish models.jsonl to Cloudflare D1 without destructive reconciliation."""
from __future__ import annotations

import argparse
import json
import os
import re
import sys
import unicodedata
import urllib.error
import urllib.request
from collections import Counter
from pathlib import Path, PurePosixPath
from typing import Any

from publish_r2 import discover as discover_r2
from publish_r2 import load_state as load_r2_state
from catalog_scope import PUBLIC_TOP_LEVEL_CATEGORIES, PUBLIC_TOP_LEVEL_KEYS

CATEGORY_ORDER = {
    name: (index + 1) * 10
    for index, name in enumerate(PUBLIC_TOP_LEVEL_CATEGORIES)
}
REQUIRED = {
    "id", "slug", "code", "displayName", "categoryName", "categorySlug",
    "franchiseName", "franchiseSlug", "collection", "folderPath", "folderPathKey", "searchText",
    "imageCount", "coverStorageKey", "galleryManifestKey", "galleryVersion",
}


def slugify(value: str) -> str:
    normalized = unicodedata.normalize("NFKD", value)
    ascii_value = normalized.encode("ascii", "ignore").decode("ascii").lower()
    return re.sub(r"[^a-z0-9]+", "-", ascii_value).strip("-") or "pasta"


def folder_entries(rows: list[dict[str, Any]]) -> list[tuple[str, str, str, str, str, int]]:
    entries: dict[tuple[str, str, str], tuple[str, str, str, str, str, int]] = {}
    for row in rows:
        names = row.get("folderPath")
        if not isinstance(names, list) or not all(isinstance(item, str) and item.strip() for item in names):
            raise RuntimeError(f"folderPath inválido no modelo {row['id']}")
        slugs = [slugify(item) for item in names]
        expected_key = "/".join(slugs)
        if str(row.get("folderPathKey") or "") != expected_key:
            raise RuntimeError(f"folderPathKey divergente no modelo {row['id']}")
        for depth in range(1, len(names) + 1):
            path = "/".join(slugs[:depth])
            parent = "/".join(slugs[:depth - 1])
            key = (str(row["categorySlug"]), str(row["franchiseSlug"]), path)
            value = (str(row["categorySlug"]), str(row["franchiseSlug"]), parent, slugs[depth - 1], names[depth - 1].strip(), depth)
            previous = entries.get(key)
            if previous and previous != value:
                raise RuntimeError(f"conflito de pasta pública: {key}")
            entries[key] = value
    return sorted(entries.values(), key=lambda item: (item[5], item[0], item[1], item[2], item[3]))


def load_models(path: Path) -> list[dict[str, Any]]:
    rows: list[dict[str, Any]] = []
    with path.open("r", encoding="utf-8") as handle:
        for line_no, line in enumerate(handle, 1):
            if not line.strip():
                continue
            try:
                row = json.loads(line)
            except json.JSONDecodeError as exc:
                raise RuntimeError(f"JSON inválido em {path}:{line_no}: {exc}") from exc
            missing = REQUIRED.difference(row)
            if missing:
                raise RuntimeError(f"campos ausentes em {path}:{line_no}: {sorted(missing)}")
            rows.append(row)
    if not rows:
        raise RuntimeError(f"índice vazio: {path}")
    validate_models(rows)
    return rows


def validate_models(rows: list[dict[str, Any]]) -> None:
    for key in ("id", "slug", "code"):
        counts = Counter(str(row[key]).strip() for row in rows)
        duplicates = sorted(value for value, count in counts.items() if not value or count > 1)
        if duplicates:
            raise RuntimeError(f"{key} vazio ou duplicado: {duplicates[:5]}")
    for row in rows:
        category_name = str(row["categoryName"]).strip()
        if category_name.casefold() not in PUBLIC_TOP_LEVEL_KEYS:
            raise RuntimeError(f"categoria fora do escopo público no modelo {row['id']}: {category_name!r}")
        if not str(row["categorySlug"]).strip() or not str(row["franchiseSlug"]).strip():
            raise RuntimeError(f"taxonomia vazia no modelo {row['id']}")
        if int(row["imageCount"]) < 1:
            raise RuntimeError(f"modelo sem imagem publicável: {row['id']}")
    folder_entries(rows)


def safe_storage_key(value: Any, expected_prefix: str, model_id: str) -> str:
    key = str(value or "").strip()
    path = PurePosixPath(key)
    if (
        not key
        or key.startswith("/")
        or "\\" in key
        or ".." in path.parts
        or not key.startswith(expected_prefix)
    ):
        raise RuntimeError(f"chave R2 inválida no modelo {model_id}: {key!r}")
    return key


def validate_r2_ready(models_path: Path, rows: list[dict[str, Any]], state_path: Path) -> dict[str, Any]:
    models_path = models_path.resolve()
    r2_root = models_path.parent / "r2"
    if not r2_root.is_dir():
        raise RuntimeError(f"bundle R2 ausente: {r2_root}")

    state = load_r2_state(state_path)
    candidates = discover_r2(r2_root, state)
    if not candidates:
        raise RuntimeError(f"bundle R2 vazio: {r2_root}")

    by_key = {candidate.key: candidate for candidate in candidates}
    required_keys: set[str] = set()

    for row in rows:
        model_id = str(row["id"])
        cover_key = safe_storage_key(row["coverStorageKey"], "media/", model_id)
        manifest_key = safe_storage_key(row["galleryManifestKey"], "gallery/", model_id)
        required_keys.update((cover_key, manifest_key))

        manifest_path = r2_root / PurePosixPath(manifest_key)
        if not manifest_path.is_file():
            raise RuntimeError(f"manifesto de galeria ausente no bundle: {manifest_key}")
        try:
            manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError) as exc:
            raise RuntimeError(f"manifesto de galeria inválido: {manifest_key}: {exc}") from exc
        if str(manifest.get("modelId") or "") != model_id:
            raise RuntimeError(f"manifesto pertence a outro modelo: {manifest_key}")
        images = manifest.get("images")
        if not isinstance(images, list) or len(images) != int(row["imageCount"]):
            raise RuntimeError(f"quantidade de imagens divergente no manifesto: {manifest_key}")
        for image in images:
            if not isinstance(image, dict) or not isinstance(image.get("variantKeys"), dict):
                raise RuntimeError(f"variantKeys inválido no manifesto: {manifest_key}")
            variants = image["variantKeys"]
            for variant_name in ("thumb", "card", "detail"):
                required_keys.add(safe_storage_key(variants.get(variant_name), "media/", model_id))

    missing_from_bundle = sorted(required_keys.difference(by_key))
    if missing_from_bundle:
        raise RuntimeError(
            f"bundle R2 incompleto: {len(missing_from_bundle)} chave(s) referenciada(s) ausente(s): "
            f"{missing_from_bundle[:5]}"
        )

    state_objects = state["objects"]
    pending = sorted(
        candidate.key
        for candidate in candidates
        if state_objects.get(candidate.key, {}).get("published_sha256") != candidate.sha256
    )
    if pending:
        raise RuntimeError(
            f"R2 ainda não está pronto: {len(pending)} de {len(candidates)} objeto(s) sem publicação confirmada "
            f"no checkpoint: {pending[:5]}"
        )

    return {
        "objects": len(candidates),
        "requiredKeys": len(required_keys),
        "checkpoint": str(state_path),
        "ready": True,
    }


def build_statements(rows: list[dict[str, Any]]) -> list[dict[str, Any]]:
    statements: list[dict[str, Any]] = []
    categories = {
        (str(row["categorySlug"]), str(row["categoryName"]))
        for row in rows
    }
    for slug, name in sorted(categories):
        statements.append({
            "sql": """INSERT INTO categories(slug,name,sort_order)
VALUES(?,?,?)
ON CONFLICT(slug) DO UPDATE SET name=excluded.name,sort_order=excluded.sort_order""",
            "params": [slug, name, str(CATEGORY_ORDER.get(name, 900))],
        })

    franchises = {
        (
            str(row["categorySlug"]), str(row["franchiseSlug"]),
            str(row["franchiseName"]),
        )
        for row in rows
    }
    for category_slug, slug, name in sorted(franchises):
        statements.append({
            "sql": """INSERT INTO franchises(category_id,slug,name)
SELECT id,?,? FROM categories WHERE slug=?
ON CONFLICT(category_id,slug) DO UPDATE SET name=excluded.name""",
            "params": [slug, name, category_slug],
        })

    for category_slug, franchise_slug, parent_path, folder_slug, folder_name, depth in folder_entries(rows):
        path = "/".join([part for part in [parent_path, folder_slug] if part])
        statements.append({
            "sql": """INSERT INTO catalog_folders(franchise_id,parent_id,slug,name,path,depth,sort_order)
SELECT f.id,
  CASE WHEN ?='' THEN NULL ELSE (SELECT id FROM catalog_folders WHERE franchise_id=f.id AND path=?) END,
  ?,?,?,?,0
FROM franchises f JOIN categories c ON c.id=f.category_id
WHERE c.slug=? AND f.slug=?
ON CONFLICT(franchise_id,path) DO UPDATE SET
parent_id=excluded.parent_id,slug=excluded.slug,name=excluded.name,depth=excluded.depth,sort_order=excluded.sort_order""",
            "params": [parent_path, parent_path, folder_slug, folder_name, path, str(depth), category_slug, franchise_slug],
        })
    for row in sorted(rows, key=lambda item: str(item["id"])):
        statements.append({
            "sql": """INSERT INTO models(
id,franchise_id,folder_id,slug,code,name,collection,image_count,cover_storage_key,
gallery_manifest_key,gallery_version,published,search_text,updated_at)
SELECT ?,f.id,
  CASE WHEN ?='' THEN NULL ELSE (SELECT id FROM catalog_folders WHERE franchise_id=f.id AND path=?) END,
  ?,?,?,?,?,?,?,?,1,?,CURRENT_TIMESTAMP
FROM franchises f JOIN categories c ON c.id=f.category_id
WHERE c.slug=? AND f.slug=?
ON CONFLICT(id) DO UPDATE SET
franchise_id=excluded.franchise_id,folder_id=excluded.folder_id,slug=excluded.slug,code=excluded.code,
name=excluded.name,collection=excluded.collection,image_count=excluded.image_count,
cover_storage_key=excluded.cover_storage_key,gallery_manifest_key=excluded.gallery_manifest_key,
gallery_version=excluded.gallery_version,published=1,
search_text=excluded.search_text,updated_at=CURRENT_TIMESTAMP""",
            "params": [
                str(row["id"]), str(row["folderPathKey"] or ""), str(row["folderPathKey"] or ""), str(row["slug"]), str(row["code"]),
                str(row["displayName"]), str(row["collection"] or ""),
                str(int(row["imageCount"])), str(row["coverStorageKey"] or ""),
                str(row["galleryManifestKey"] or ""),
                str(int(row["galleryVersion"])), str(row["searchText"]),
                str(row["categorySlug"]), str(row["franchiseSlug"]),
            ],
        })
    return statements


def chunked(items: list[dict[str, Any]], size: int):
    for start in range(0, len(items), size):
        yield items[start:start + size]


def production_lookup_statements(rows: list[dict[str, Any]], chunk_size: int = 25) -> list[dict[str, Any]]:
    if chunk_size < 1:
        raise ValueError("chunk_size deve ser positivo")
    statements: list[dict[str, Any]] = []
    for start in range(0, len(rows), chunk_size):
        chunk = rows[start:start + chunk_size]
        ids = [str(row["id"]) for row in chunk]
        slugs = [str(row["slug"]) for row in chunk]
        codes = [str(row["code"]) for row in chunk]
        placeholders = ",".join("?" for _ in chunk)
        statements.append({
            "sql": f"""SELECT
m.id,m.slug,m.code,c.slug AS category_slug,f.slug AS franchise_slug
FROM models m
JOIN franchises f ON f.id=m.franchise_id
JOIN categories c ON c.id=f.category_id
WHERE m.id IN ({placeholders})
   OR m.slug IN ({placeholders})
   OR m.code IN ({placeholders})""",
            "params": [*ids, *slugs, *codes],
        })
    return statements


def validate_production_compatibility(
    rows: list[dict[str, Any]],
    production_rows: list[dict[str, Any]],
) -> dict[str, Any]:
    by_id: dict[str, dict[str, Any]] = {}
    by_slug: dict[str, dict[str, Any]] = {}
    by_code: dict[str, dict[str, Any]] = {}
    for row in production_rows:
        model_id = str(row.get("id") or "").strip()
        slug = str(row.get("slug") or "").strip()
        code = str(row.get("code") or "").strip()
        if not model_id or not slug or not code:
            raise RuntimeError(f"baseline D1 inválido: {row!r}")
        if model_id in by_id and by_id[model_id] != row:
            raise RuntimeError(f"ID duplicado no baseline D1: {model_id}")
        if slug in by_slug and str(by_slug[slug].get("id")) != model_id:
            raise RuntimeError(f"slug duplicado no baseline D1: {slug}")
        if code in by_code and str(by_code[code].get("id")) != model_id:
            raise RuntimeError(f"código duplicado no baseline D1: {code}")
        by_id[model_id] = row
        by_slug[slug] = row
        by_code[code] = row

    existing = 0
    new = 0
    for candidate in rows:
        model_id = str(candidate["id"]).strip()
        slug = str(candidate["slug"]).strip()
        code = str(candidate["code"]).strip()
        category_slug = str(candidate["categorySlug"]).strip()
        franchise_slug = str(candidate["franchiseSlug"]).strip()

        current = by_id.get(model_id)
        slug_owner = by_slug.get(slug)
        code_owner = by_code.get(code)

        if current is None:
            if slug_owner is not None:
                raise RuntimeError(
                    f"novo ID colide com slug já publicado: {model_id} -> {slug}; "
                    f"owner={slug_owner['id']}"
                )
            if code_owner is not None:
                raise RuntimeError(
                    f"novo ID colide com código já publicado: {model_id} -> {code}; "
                    f"owner={code_owner['id']}"
                )
            new += 1
            continue

        existing += 1
        if str(current["slug"]) != slug:
            raise RuntimeError(
                f"slug de modelo publicado mudaria para o mesmo ID: {model_id}: "
                f"{current['slug']!r} -> {slug!r}"
            )
        if str(current["code"]) != code:
            raise RuntimeError(
                f"código de modelo publicado mudaria para o mesmo ID: {model_id}: "
                f"{current['code']!r} -> {code!r}"
            )
        if str(current.get("category_slug") or "") != category_slug:
            raise RuntimeError(
                f"categoria de modelo publicado mudaria sem migração explícita: {model_id}: "
                f"{current.get('category_slug')!r} -> {category_slug!r}"
            )
        if str(current.get("franchise_slug") or "") != franchise_slug:
            raise RuntimeError(
                f"franquia de modelo publicado mudaria sem migração explícita: {model_id}: "
                f"{current.get('franchise_slug')!r} -> {franchise_slug!r}"
            )
        if slug_owner is not None and str(slug_owner["id"]) != model_id:
            raise RuntimeError(f"slug pertence a outro modelo publicado: {slug} -> {slug_owner['id']}")
        if code_owner is not None and str(code_owner["id"]) != model_id:
            raise RuntimeError(f"código pertence a outro modelo publicado: {code} -> {code_owner['id']}")

    return {
        "ready": True,
        "candidateModels": len(rows),
        "existingModels": existing,
        "newModels": new,
        "productionMatches": len(production_rows),
    }


def request_batch_json(
    account_id: str,
    database_id: str,
    token: str,
    batch: list[dict[str, Any]],
) -> dict[str, Any]:
    url = (
        "https://api.cloudflare.com/client/v4/accounts/"
        f"{account_id}/d1/database/{database_id}/query"
    )
    payload = json.dumps({"batch": batch}).encode("utf-8")
    request = urllib.request.Request(
        url,
        data=payload,
        method="POST",
        headers={
            "Authorization": f"Bearer {token}",
            "Content-Type": "application/json",
            "User-Agent": "tonecos-catalogo-publisher/1",
        },
    )
    try:
        with urllib.request.urlopen(request, timeout=60) as response:
            body = json.loads(response.read().decode("utf-8"))
    except urllib.error.HTTPError as exc:
        detail = exc.read().decode("utf-8", errors="replace")
        raise RuntimeError(f"D1 HTTP {exc.code}: {detail}") from exc
    if not body.get("success"):
        raise RuntimeError(f"D1 recusou batch: {body.get('errors')}")
    return body


def fetch_production_matches(
    account_id: str,
    database_id: str,
    token: str,
    rows: list[dict[str, Any]],
) -> list[dict[str, Any]]:
    statements = production_lookup_statements(rows)
    if not statements:
        return []
    body = request_batch_json(account_id, database_id, token, statements)
    result = body.get("result")
    if not isinstance(result, list) or len(result) != len(statements):
        raise RuntimeError("resposta inesperada ao consultar baseline D1")
    matches: dict[str, dict[str, Any]] = {}
    for item in result:
        if not isinstance(item, dict) or item.get("success") is not True:
            raise RuntimeError(f"consulta de baseline D1 falhou: {item!r}")
        rows_found = item.get("results")
        if not isinstance(rows_found, list):
            raise RuntimeError("consulta de baseline D1 retornou results inválido")
        for row in rows_found:
            if not isinstance(row, dict):
                raise RuntimeError("linha inválida no baseline D1")
            model_id = str(row.get("id") or "").strip()
            if not model_id:
                raise RuntimeError(f"linha sem ID no baseline D1: {row!r}")
            previous = matches.get(model_id)
            if previous is not None and previous != row:
                raise RuntimeError(f"baseline D1 inconsistente para ID: {model_id}")
            matches[model_id] = row
    return list(matches.values())


def request_batch(account_id: str, database_id: str, token: str, batch: list[dict[str, Any]]) -> None:
    request_batch_json(account_id, database_id, token, batch)


def require_env(name: str) -> str:
    value = os.environ.get(name, "").strip()
    if not value:
        raise RuntimeError(f"variável obrigatória ausente: {name}")
    return value


def main() -> int:
    parser = argparse.ArgumentParser(description="Publica models.jsonl no D1 de forma idempotente.")
    parser.add_argument("models", type=Path)
    parser.add_argument("--apply", action="store_true", help="executa mutações; sem esta flag apenas valida/planeja")
    parser.add_argument(
        "--check-production",
        action="store_true",
        help="consulta o D1 em modo somente leitura e valida identidade antes de qualquer upload/publicação",
    )
    parser.add_argument("--batch-size", type=int, default=100)
    parser.add_argument("--r2-state", type=Path, help="checkpoint R2; padrão: r2-publish-state.json ao lado de models.jsonl")
    args = parser.parse_args()

    if not args.models.is_file():
        parser.error(f"arquivo não encontrado: {args.models}")
    if args.batch_size < 1 or args.batch_size > 500:
        parser.error("--batch-size deve ficar entre 1 e 500")

    try:
        rows = load_models(args.models)
        statements = build_statements(rows)
        summary: dict[str, Any] = {
            "models": len(rows),
            "categories": len({row["categorySlug"] for row in rows}),
            "franchises": len({(row["categorySlug"], row["franchiseSlug"]) for row in rows}),
            "folders": len(folder_entries(rows)),
            "statements": len(statements),
            "apply": args.apply,
            "destructiveDeletes": 0,
        }
        if not args.apply and not args.check_production:
            print(json.dumps(summary, ensure_ascii=False))
            return 0

        account_id = require_env("CLOUDFLARE_ACCOUNT_ID")
        database_id = require_env("CLOUDFLARE_D1_DATABASE_ID")
        token = require_env("CLOUDFLARE_API_TOKEN")
        production_rows = fetch_production_matches(account_id, database_id, token, rows)
        summary["productionCompatibility"] = validate_production_compatibility(rows, production_rows)

        if not args.apply:
            print(json.dumps(summary, ensure_ascii=False))
            return 0

        state_path = args.r2_state.resolve() if args.r2_state else args.models.resolve().parent / "r2-publish-state.json"
        summary["r2Gate"] = validate_r2_ready(args.models, rows, state_path)

        batches = 0
        for batch in chunked(statements, args.batch_size):
            request_batch(account_id, database_id, token, batch)
            batches += 1
        summary["batches"] = batches
        print(json.dumps(summary, ensure_ascii=False))
        return 0
    except RuntimeError as exc:
        print(f"ERRO: {exc}", file=sys.stderr)
        return 2


if __name__ == "__main__":
    sys.exit(main())
