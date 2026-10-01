#!/usr/bin/env python3
"""Idempotently publish generated catalog metadata to Cloudflare D1.

This publisher never deletes or unpublishes rows implicitly. It validates the
complete models.jsonl input, upserts taxonomy first, then models in bounded D1
batches. Use --dry-run to validate and summarize without network access.
"""
from __future__ import annotations

import argparse
import json
import os
import sys
import urllib.error
import urllib.request
from dataclasses import dataclass
from pathlib import Path
from typing import Any

DEFAULT_BATCH_SIZE = 50
MAX_BATCH_SIZE = 100


@dataclass(frozen=True)
class Query:
    sql: str
    params: list[Any]


@dataclass(frozen=True)
class CatalogPlan:
    categories: list[dict[str, str]]
    franchises: list[dict[str, str]]
    models: list[dict[str, Any]]


REQUIRED_MODEL_FIELDS = {
    "id", "slug", "code", "categoryName", "categorySlug",
    "franchiseName", "franchiseSlug", "displayName", "searchText",
    "imageCount", "galleryVersion",
}


def load_models(path: Path) -> list[dict[str, Any]]:
    if not path.is_file():
        raise FileNotFoundError(f"models.jsonl não encontrado: {path}")
    models: list[dict[str, Any]] = []
    seen_ids: set[str] = set()
    seen_slugs: set[str] = set()
    seen_codes: set[str] = set()
    with path.open("r", encoding="utf-8") as handle:
        for line_no, line in enumerate(handle, 1):
            if not line.strip():
                continue
            try:
                row = json.loads(line)
            except json.JSONDecodeError as exc:
                raise RuntimeError(f"JSON inválido em {path}:{line_no}: {exc}") from exc
            missing = sorted(REQUIRED_MODEL_FIELDS - row.keys())
            if missing:
                raise RuntimeError(f"campos ausentes em {path}:{line_no}: {missing}")
            for field in ("id", "slug", "code", "categorySlug", "franchiseSlug", "displayName"):
                if not isinstance(row[field], str) or not row[field].strip():
                    raise RuntimeError(f"campo {field} inválido em {path}:{line_no}")
            if row["id"] in seen_ids:
                raise RuntimeError(f"id duplicado em models.jsonl: {row['id']}")
            if row["slug"] in seen_slugs:
                raise RuntimeError(f"slug duplicado em models.jsonl: {row['slug']}")
            if row["code"] in seen_codes:
                raise RuntimeError(f"code duplicado em models.jsonl: {row['code']}")
            if not isinstance(row["imageCount"], int) or row["imageCount"] < 0:
                raise RuntimeError(f"imageCount inválido em {path}:{line_no}")
            if not isinstance(row["galleryVersion"], int) or row["galleryVersion"] < 1:
                raise RuntimeError(f"galleryVersion inválido em {path}:{line_no}")
            seen_ids.add(row["id"])
            seen_slugs.add(row["slug"])
            seen_codes.add(row["code"])
            models.append(row)
    if not models:
        raise RuntimeError(f"models.jsonl vazio: {path}")
    return models


def build_plan(models: list[dict[str, Any]]) -> CatalogPlan:
    categories: dict[str, str] = {}
    franchises: dict[tuple[str, str], str] = {}
    for model in models:
        category_slug = model["categorySlug"]
        category_name = model["categoryName"]
        franchise_slug = model["franchiseSlug"]
        franchise_name = model["franchiseName"]
        previous_category = categories.setdefault(category_slug, category_name)
        if previous_category != category_name:
            raise RuntimeError(f"categoria inconsistente para slug {category_slug}")
        key = (category_slug, franchise_slug)
        previous_franchise = franchises.setdefault(key, franchise_name)
        if previous_franchise != franchise_name:
            raise RuntimeError(f"franquia inconsistente para {category_slug}/{franchise_slug}")
    category_rows = [
        {"slug": slug, "name": name}
        for slug, name in sorted(categories.items())
    ]
    franchise_rows = [
        {"categorySlug": category_slug, "slug": franchise_slug, "name": name}
        for (category_slug, franchise_slug), name in sorted(franchises.items())
    ]
    return CatalogPlan(category_rows, franchise_rows, sorted(models, key=lambda row: row["id"]))


def category_query(row: dict[str, str]) -> Query:
    return Query(
        """INSERT INTO categories(slug,name,sort_order,model_count)
VALUES(?,?,0,0)
ON CONFLICT(slug) DO UPDATE SET name=excluded.name""",
        [row["slug"], row["name"]],
    )


def franchise_query(row: dict[str, str]) -> Query:
    return Query(
        """INSERT INTO franchises(category_id,slug,name,model_count)
SELECT id,?,?,0 FROM categories WHERE slug=?
ON CONFLICT(category_id,slug) DO UPDATE SET name=excluded.name""",
        [row["slug"], row["name"], row["categorySlug"]],
    )


def model_query(row: dict[str, Any]) -> Query:
    return Query(
        """INSERT INTO models(
  id,franchise_id,slug,code,name,collection,image_count,
  cover_storage_key,gallery_manifest_key,gallery_version,published,search_text,updated_at
)
SELECT ?,f.id,?,?,?,?,?,?,?,?,1,?,CURRENT_TIMESTAMP
FROM franchises f JOIN categories c ON c.id=f.category_id
WHERE c.slug=? AND f.slug=?
ON CONFLICT(id) DO UPDATE SET
  franchise_id=excluded.franchise_id,
  slug=excluded.slug,
  code=excluded.code,
  name=excluded.name,
  collection=excluded.collection,
  image_count=excluded.image_count,
  cover_storage_key=excluded.cover_storage_key,
  gallery_manifest_key=excluded.gallery_manifest_key,
  gallery_version=excluded.gallery_version,
  published=1,
  search_text=excluded.search_text,
  updated_at=CURRENT_TIMESTAMP""",
        [
            row["id"], row["slug"], row["code"], row["displayName"],
            row.get("collection") or None, row["imageCount"],
            row.get("coverStorageKey"), row.get("galleryManifestKey"),
            row["galleryVersion"], row["searchText"],
            row["categorySlug"], row["franchiseSlug"],
        ],
    )


class D1Client:
    def __init__(self, account_id: str, database_id: str, api_token: str) -> None:
        self.url = (
            f"https://api.cloudflare.com/client/v4/accounts/{account_id}"
            f"/d1/database/{database_id}/query"
        )
        self.api_token = api_token

    def batch(self, queries: list[Query]) -> None:
        body = json.dumps({
            "batch": [{"sql": query.sql, "params": query.params} for query in queries]
        }).encode("utf-8")
        request = urllib.request.Request(
            self.url,
            data=body,
            method="POST",
            headers={
                "Authorization": f"Bearer {self.api_token}",
                "Content-Type": "application/json",
                "User-Agent": "tonecos-catalogo-publisher/1",
            },
        )
        try:
            with urllib.request.urlopen(request, timeout=120) as response:
                payload = json.loads(response.read().decode("utf-8"))
        except urllib.error.HTTPError as exc:
            detail = exc.read().decode("utf-8", errors="replace")
            raise RuntimeError(f"Cloudflare D1 HTTP {exc.code}: {detail}") from exc
        except urllib.error.URLError as exc:
            raise RuntimeError(f"falha de rede Cloudflare D1: {exc}") from exc
        if not payload.get("success"):
            raise RuntimeError(f"Cloudflare D1 rejeitou batch: {payload.get('errors')}")
        results = payload.get("result")
        if not isinstance(results, list):
            raise RuntimeError("resposta D1 sem lista de resultados")
        failed = [item for item in results if isinstance(item, dict) and item.get("success") is False]
        if failed:
            raise RuntimeError(f"query D1 falhou dentro do batch: {failed[:1]}")


def chunks(items: list[Query], size: int):
    for offset in range(0, len(items), size):
        yield items[offset:offset + size]


def publish(plan: CatalogPlan, client: D1Client, batch_size: int) -> dict[str, int]:
    groups = [
        [category_query(row) for row in plan.categories],
        [franchise_query(row) for row in plan.franchises],
        [model_query(row) for row in plan.models],
    ]
    batches = 0
    queries = 0
    for group in groups:
        for batch in chunks(group, batch_size):
            client.batch(batch)
            batches += 1
            queries += len(batch)
    return {
        "categories": len(plan.categories),
        "franchises": len(plan.franchises),
        "models": len(plan.models),
        "batches": batches,
        "queries": queries,
    }


def env_required(name: str) -> str:
    value = os.environ.get(name, "").strip()
    if not value:
        raise RuntimeError(f"variável obrigatória ausente: {name}")
    return value


def main() -> int:
    parser = argparse.ArgumentParser(description="Publica models.jsonl no D1 sem exclusões implícitas.")
    parser.add_argument("models", type=Path)
    parser.add_argument("--batch-size", type=int, default=DEFAULT_BATCH_SIZE)
    parser.add_argument("--dry-run", action="store_true")
    args = parser.parse_args()
    if not 1 <= args.batch_size <= MAX_BATCH_SIZE:
        parser.error(f"--batch-size deve ficar entre 1 e {MAX_BATCH_SIZE}")
    try:
        plan = build_plan(load_models(args.models.resolve()))
        if args.dry_run:
            summary = {
                "categories": len(plan.categories),
                "franchises": len(plan.franchises),
                "models": len(plan.models),
                "dryRun": True,
            }
        else:
            client = D1Client(
                account_id=env_required("CLOUDFLARE_ACCOUNT_ID"),
                database_id=env_required("CLOUDFLARE_D1_DATABASE_ID"),
                api_token=env_required("CLOUDFLARE_API_TOKEN"),
            )
            summary = {**publish(plan, client, args.batch_size), "dryRun": False}
    except (FileNotFoundError, RuntimeError) as exc:
        print(f"ERRO: {exc}", file=sys.stderr)
        return 2
    print(json.dumps(summary, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    sys.exit(main())
