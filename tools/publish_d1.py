#!/usr/bin/env python3
"""Idempotently publish generated catalog metadata to Cloudflare D1.

Consumes models.jsonl from build_media_bundle.py. The publisher never deletes
models and never overwrites curated fields that are absent from the generated
manifest. Partial failures are safe to retry because every write is an upsert.
"""
from __future__ import annotations

import argparse
import json
import os
import sys
import time
from pathlib import Path
from typing import Any, Iterable
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen

DEFAULT_BATCH_SIZE = 75
MAX_BATCH_SIZE = 100

REQUIRED_TEXT = (
    "id", "slug", "code", "categoryName", "categorySlug",
    "franchiseName", "franchiseSlug", "displayName", "searchText",
    "coverStorageKey", "galleryManifestKey",
)
def _text(row: dict[str, Any], key: str, line: int) -> str:
    value = row.get(key)
    if not isinstance(value, str) or not value.strip():
        raise ValueError(f"linha {line}: campo obrigatório inválido: {key}")
    return value.strip()


def validate_record(row: dict[str, Any], line: int) -> dict[str, Any]:
    if not isinstance(row, dict):
        raise ValueError(f"linha {line}: registro deve ser um objeto JSON")
    normalized = dict(row)
    for key in REQUIRED_TEXT:
        normalized[key] = _text(row, key, line)

    image_count = row.get("imageCount")
    gallery_version = row.get("galleryVersion")
    if not isinstance(image_count, int) or image_count < 1:
        raise ValueError(f"linha {line}: imageCount deve ser inteiro positivo")
    if not isinstance(gallery_version, int) or gallery_version < 1:
        raise ValueError(f"linha {line}: galleryVersion deve ser inteiro positivo")

    hierarchy = row.get("sourceHierarchy")
    if not isinstance(hierarchy, list) or len(hierarchy) < 2:
        raise ValueError(f"linha {line}: sourceHierarchy precisa conter categoria e franquia")
    if hierarchy[0] != normalized["categoryName"] or hierarchy[1] != normalized["franchiseName"]:
        raise ValueError(f"linha {line}: taxonomia diverge de sourceHierarchy")

    collection = row.get("collection", "")
    if collection is None:
        collection = ""
    if not isinstance(collection, str):
        raise ValueError(f"linha {line}: collection deve ser texto")

    normalized["collection"] = collection.strip()
    normalized["imageCount"] = image_count
    normalized["galleryVersion"] = gallery_version
    return normalized


def load_models(path: Path) -> list[dict[str, Any]]:
    if not path.is_file():
        raise FileNotFoundError(f"manifesto D1 não encontrado: {path}")
    rows: list[dict[str, Any]] = []
    with path.open("r", encoding="utf-8") as handle:
        for line_number, raw in enumerate(handle, 1):
            if raw.strip():
                rows.append(validate_record(json.loads(raw), line_number))
    if not rows:
        raise ValueError("manifesto D1 vazio")
    return validate_manifest(rows)
def validate_manifest(rows: list[dict[str, Any]]) -> list[dict[str, Any]]:
    unique_fields = {"id": {}, "slug": {}, "code": {}}
    categories: dict[str, str] = {}
    franchises: dict[tuple[str, str], str] = {}

    for row in rows:
        for field, seen in unique_fields.items():
            value = row[field]
            previous = seen.get(value)
            if previous is not None and previous != row["id"]:
                raise ValueError(f"colisão de {field}: {value}")
            seen[value] = row["id"]

        category_slug = row["categorySlug"]
        old_category = categories.setdefault(category_slug, row["categoryName"])
        if old_category != row["categoryName"]:
            raise ValueError(f"categoria inconsistente: {category_slug}")

        franchise_key = (category_slug, row["franchiseSlug"])
        old_franchise = franchises.setdefault(franchise_key, row["franchiseName"])
        if old_franchise != row["franchiseName"]:
            raise ValueError(f"franquia inconsistente: {franchise_key[1]}")

    return sorted(rows, key=lambda row: (
        row["categorySlug"], row["franchiseSlug"], row["slug"], row["id"]
    ))
def build_statements(rows: list[dict[str, Any]]) -> list[dict[str, Any]]:
    categories = sorted({
        (row["categorySlug"], row["categoryName"])
        for row in rows
    })
    franchises = sorted({
        (row["categorySlug"], row["franchiseSlug"], row["franchiseName"])
        for row in rows
    })
    statements: list[dict[str, Any]] = []

    for slug, name in categories:
        statements.append({
            "sql": (
                "INSERT INTO categories(slug,name) VALUES(?,?) "
                "ON CONFLICT(slug) DO UPDATE SET name=excluded.name"
            ),
            "params": [slug, name],
        })

    for category_slug, slug, name in franchises:
        statements.append({
            "sql": (
                "INSERT INTO franchises(category_id,slug,name) "
                "VALUES((SELECT id FROM categories WHERE slug=?),?,?) "
                "ON CONFLICT(category_id,slug) DO UPDATE SET name=excluded.name"
            ),
            "params": [category_slug, slug, name],
        })
    model_sql = (
        "INSERT INTO models("
        "id,franchise_id,slug,code,name,collection,image_count,"
        "cover_storage_key,gallery_manifest_key,gallery_version,published,search_text,updated_at"
        ") VALUES(?,("
        "SELECT f.id FROM franchises f JOIN categories c ON c.id=f.category_id "
        "WHERE c.slug=? AND f.slug=?"
        "),?,?,?,?,?,?,?,?,1,?,CURRENT_TIMESTAMP) "
        "ON CONFLICT(id) DO UPDATE SET "
        "franchise_id=excluded.franchise_id,slug=excluded.slug,code=excluded.code,"
        "name=excluded.name,collection=excluded.collection,image_count=excluded.image_count,"
        "cover_storage_key=excluded.cover_storage_key,"
        "gallery_manifest_key=excluded.gallery_manifest_key,"
        "gallery_version=excluded.gallery_version,published=1,"
        "search_text=excluded.search_text,updated_at=CURRENT_TIMESTAMP"
    )
    for row in rows:
        statements.append({
            "sql": model_sql,
            "params": [
                row["id"], row["categorySlug"], row["franchiseSlug"],
                row["slug"], row["code"], row["displayName"], row["collection"],
                row["imageCount"], row["coverStorageKey"],
                row["galleryManifestKey"], row["galleryVersion"], row["searchText"],
            ],
        })
    return statements
def chunks(values: list[dict[str, Any]], size: int) -> Iterable[list[dict[str, Any]]]:
    for start in range(0, len(values), size):
        yield values[start:start + size]


class CloudflareD1Client:
    def __init__(self, account_id: str, database_id: str, token: str) -> None:
        self.endpoint = (
            "https://api.cloudflare.com/client/v4/accounts/"
            f"{account_id}/d1/database/{database_id}/query"
        )
        self.token = token

    def execute_batch(self, statements: list[dict[str, Any]]) -> None:
        payload = json.dumps({"batch": statements}).encode("utf-8")
        request = Request(
            self.endpoint,
            data=payload,
            method="POST",
            headers={
                "Authorization": f"Bearer {self.token}",
                "Content-Type": "application/json",
            },
        )
        last_error: Exception | None = None
        for attempt in range(4):
            try:
                with urlopen(request, timeout=60) as response:
                    body = json.loads(response.read().decode("utf-8"))
                if body.get("success") is not True:
                    raise RuntimeError(f"D1 rejeitou lote: {body.get('errors', [])}")
                results = body.get("result", [])
                failed = [item for item in results if item.get("success") is False]
                if failed:
                    raise RuntimeError(f"D1 falhou em {len(failed)} statement(s)")
                return
            except HTTPError as exc:
                detail = exc.read().decode("utf-8", errors="replace")
                last_error = RuntimeError(f"D1 HTTP {exc.code}: {detail[:600]}")
                if exc.code not in {429, 500, 502, 503, 504}:
                    break
            except (URLError, TimeoutError) as exc:
                last_error = exc
            if attempt < 3:
                time.sleep(2 ** attempt)
        raise RuntimeError(f"falha ao publicar lote D1: {last_error}")


def publish(
    rows: list[dict[str, Any]],
    client: CloudflareD1Client | Any,
    batch_size: int = DEFAULT_BATCH_SIZE,
    dry_run: bool = False,
) -> dict[str, Any]:
    if not 1 <= batch_size <= MAX_BATCH_SIZE:
        raise ValueError(f"batch_size deve ficar entre 1 e {MAX_BATCH_SIZE}")
    statements = build_statements(rows)
    category_count = len({row["categorySlug"] for row in rows})
    franchise_count = len({
        (row["categorySlug"], row["franchiseSlug"]) for row in rows
    })
    batches = list(chunks(statements, batch_size))
    summary = {
        "models": len(rows),
        "categories": category_count,
        "franchises": franchise_count,
        "statements": len(statements),
        "batches": len(batches),
        "dryRun": dry_run,
    }
    if dry_run:
        return summary
    for batch in batches:
        client.execute_batch(batch)
    return summary


def env_required(name: str) -> str:
    value = os.environ.get(name, "").strip()
    if not value:
        raise RuntimeError(f"variável obrigatória ausente: {name}")
    return value


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Publica models.jsonl no D1 com upserts idempotentes."
    )
    parser.add_argument("manifest", type=Path)
    parser.add_argument("--batch-size", type=int, default=DEFAULT_BATCH_SIZE)
    parser.add_argument("--dry-run", action="store_true")
    args = parser.parse_args()
    try:
        rows = load_models(args.manifest.resolve())
        client = None
        if not args.dry_run:
            client = CloudflareD1Client(
                account_id=env_required("CLOUDFLARE_ACCOUNT_ID"),
                database_id=env_required("CLOUDFLARE_D1_DATABASE_ID"),
                token=env_required("CLOUDFLARE_API_TOKEN"),
            )
        summary = publish(
            rows=rows,
            client=client,
            batch_size=args.batch_size,
            dry_run=args.dry_run,
        )
    except (FileNotFoundError, RuntimeError, ValueError, json.JSONDecodeError) as exc:
        print(f"ERRO: {exc}", file=sys.stderr)
        return 2

    print(json.dumps(summary, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    sys.exit(main())
