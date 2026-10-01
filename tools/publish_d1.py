#!/usr/bin/env python3
"""Publish models.jsonl to Cloudflare D1 without destructive reconciliation."""
from __future__ import annotations

import argparse
import json
import os
import sys
import urllib.error
import urllib.request
from collections import Counter
from pathlib import Path
from typing import Any

CATEGORY_ORDER = {
    "Animes & Desenhos": 10,
    "Games": 20,
    "Filmes & Séries": 30,
    "Marvel & DC": 40,
    "Tokusatsu & Cultura Japonesa": 50,
    "Pessoas": 60,
}
REQUIRED = {
    "id", "slug", "code", "displayName", "categoryName", "categorySlug",
    "franchiseName", "franchiseSlug", "collection", "searchText",
    "imageCount", "coverStorageKey", "galleryManifestKey", "galleryVersion",
}
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
        if not str(row["categorySlug"]).strip() or not str(row["franchiseSlug"]).strip():
            raise RuntimeError(f"taxonomia vazia no modelo {row['id']}")
        if int(row["imageCount"]) < 1:
            raise RuntimeError(f"modelo sem imagem publicável: {row['id']}")
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
    for row in sorted(rows, key=lambda item: str(item["id"])):
        statements.append({
            "sql": """INSERT INTO models(
id,franchise_id,slug,code,name,collection,image_count,cover_storage_key,
gallery_manifest_key,gallery_version,published,search_text,updated_at)
SELECT ?,f.id,?,?,?,?,?,?,?,?,1,?,CURRENT_TIMESTAMP
FROM franchises f JOIN categories c ON c.id=f.category_id
WHERE c.slug=? AND f.slug=?
ON CONFLICT(id) DO UPDATE SET
franchise_id=excluded.franchise_id,slug=excluded.slug,code=excluded.code,
name=excluded.name,collection=excluded.collection,image_count=excluded.image_count,
cover_storage_key=excluded.cover_storage_key,
gallery_manifest_key=excluded.gallery_manifest_key,
gallery_version=excluded.gallery_version,published=1,
search_text=excluded.search_text,updated_at=CURRENT_TIMESTAMP""",
            "params": [
                str(row["id"]), str(row["slug"]), str(row["code"]),
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
def request_batch(account_id: str, database_id: str, token: str, batch: list[dict[str, Any]]) -> None:
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


def require_env(name: str) -> str:
    value = os.environ.get(name, "").strip()
    if not value:
        raise RuntimeError(f"variável obrigatória ausente: {name}")
    return value
def main() -> int:
    parser = argparse.ArgumentParser(description="Publica models.jsonl no D1 de forma idempotente.")
    parser.add_argument("models", type=Path)
    parser.add_argument("--apply", action="store_true", help="executa mutações; sem esta flag apenas valida/planeja")
    parser.add_argument("--batch-size", type=int, default=100)
    args = parser.parse_args()

    if not args.models.is_file():
        parser.error(f"arquivo não encontrado: {args.models}")
    if args.batch_size < 1 or args.batch_size > 500:
        parser.error("--batch-size deve ficar entre 1 e 500")

    try:
        rows = load_models(args.models)
        statements = build_statements(rows)
        summary = {
            "models": len(rows),
            "categories": len({row["categorySlug"] for row in rows}),
            "franchises": len({(row["categorySlug"], row["franchiseSlug"]) for row in rows}),
            "statements": len(statements),
            "apply": args.apply,
            "destructiveDeletes": 0,
        }
        if not args.apply:
            print(json.dumps(summary, ensure_ascii=False))
            return 0

        account_id = require_env("CLOUDFLARE_ACCOUNT_ID")
        database_id = require_env("CLOUDFLARE_D1_DATABASE_ID")
        token = require_env("CLOUDFLARE_API_TOKEN")
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
