#!/usr/bin/env python3
"""Verify the public catalog and its media contract.

The default mode is intentionally fast and read-only: it verifies API health,
requires a published catalog row, and proves that the model's cover object is
served by the configured public media origin.

The optional exhaustive mode walks every public catalog page and validates
identity uniqueness, required media metadata, image counts, pagination safety,
and category totals without downloading every image object.
"""
from __future__ import annotations

import argparse
import json
import os
import sys
import urllib.error
import urllib.parse
import urllib.request
from typing import Any, Callable


class CatalogSmokeError(RuntimeError):
    pass


def normalize_base(value: str, name: str) -> str:
    normalized = value.strip().rstrip("/")
    if not normalized.startswith(("https://", "http://")):
        raise CatalogSmokeError(f"{name} inválida: {value!r}")
    return normalized


def decode_json_response(response, label: str) -> dict[str, Any]:
    try:
        payload = json.loads(response.read().decode("utf-8"))
    except (UnicodeDecodeError, json.JSONDecodeError) as exc:
        raise CatalogSmokeError(f"{label} retornou JSON inválido") from exc
    if not isinstance(payload, dict):
        raise CatalogSmokeError(f"{label} retornou payload inválido")
    return payload


def open_request(opener: Callable, request: urllib.request.Request, label: str):
    try:
        return opener(request, timeout=20)
    except urllib.error.HTTPError as exc:
        raise CatalogSmokeError(f"{label} HTTP {exc.code}") from exc
    except urllib.error.URLError as exc:
        raise CatalogSmokeError(f"{label} indisponível: {exc.reason}") from exc


def public_media_url(media_base: str, storage_key: str) -> str:
    key = storage_key.strip().lstrip("/")
    if not key or "\\" in key or any(part in {"", ".", ".."} for part in key.split("/")):
        raise CatalogSmokeError(f"cover_storage_key inválida: {storage_key!r}")
    encoded = "/".join(urllib.parse.quote(part, safe="") for part in key.split("/"))
    return f"{media_base}/{encoded}"


def verify_public_catalog(
    api_base: str,
    media_base: str,
    opener: Callable = urllib.request.urlopen,
) -> dict[str, Any]:
    api_base = normalize_base(api_base, "API base")
    media_base = normalize_base(media_base, "media base")

    health_request = urllib.request.Request(
        f"{api_base}/api/health",
        headers={"Accept": "application/json", "User-Agent": "tonecos-catalog-smoke/1"},
    )
    with open_request(opener, health_request, "health") as response:
        health = decode_json_response(response, "health")
    if health.get("ok") is not True:
        raise CatalogSmokeError("health do catálogo não está ok")

    catalog_request = urllib.request.Request(
        f"{api_base}/api/catalog?limit=1",
        headers={"Accept": "application/json", "User-Agent": "tonecos-catalog-smoke/1"},
    )
    with open_request(opener, catalog_request, "catálogo") as response:
        catalog = decode_json_response(response, "catálogo")
    items = catalog.get("items")
    if not isinstance(items, list) or not items:
        raise CatalogSmokeError("catálogo público ainda não possui modelos publicados")
    first = items[0]
    if not isinstance(first, dict):
        raise CatalogSmokeError("primeiro modelo do catálogo é inválido")

    cover_key = str(first.get("cover_storage_key") or "").strip()
    if not cover_key:
        raise CatalogSmokeError("primeiro modelo não possui cover_storage_key")
    image_url = public_media_url(media_base, cover_key)
    image_request = urllib.request.Request(
        image_url,
        method="GET",
        headers={
            "Accept": "image/*",
            "Range": "bytes=0-0",
            "User-Agent": "tonecos-catalog-smoke/1",
        },
    )
    with open_request(opener, image_request, "capa pública") as response:
        status = int(getattr(response, "status", 200))
        content_type = str(response.headers.get("Content-Type", "")).split(";", 1)[0].strip().lower()
        response.read(1)
    if status not in {200, 206}:
        raise CatalogSmokeError(f"capa pública respondeu HTTP {status}")
    if not content_type.startswith("image/"):
        raise CatalogSmokeError(f"capa pública não é imagem: {content_type or 'sem content-type'}")

    return {
        "ok": True,
        "modelId": first.get("id"),
        "slug": first.get("slug"),
        "coverStorageKey": cover_key,
        "mediaStatus": status,
        "mediaContentType": content_type,
    }


def request_json(opener: Callable, url: str, label: str) -> dict[str, Any]:
    request = urllib.request.Request(
        url,
        headers={"Accept": "application/json", "User-Agent": "tonecos-catalog-audit/1"},
    )
    with open_request(opener, request, label) as response:
        return decode_json_response(response, label)


def duplicate_values(values: list[str]) -> list[str]:
    counts: dict[str, int] = {}
    for value in values:
        counts[value] = counts.get(value, 0) + 1
    return sorted(value for value, count in counts.items() if count > 1)


def verify_public_catalog_exhaustive(
    api_base: str,
    opener: Callable = urllib.request.urlopen,
    *,
    page_limit: int = 100,
    max_pages: int = 1000,
) -> dict[str, Any]:
    """Audit every published catalog row without downloading every media object."""
    api_base = normalize_base(api_base, "API base")
    if page_limit < 1:
        raise CatalogSmokeError("page_limit deve ser positivo")
    if max_pages < 1:
        raise CatalogSmokeError("max_pages deve ser positivo")

    category_payload = request_json(opener, f"{api_base}/api/categories", "categorias")
    categories = category_payload.get("items")
    if not isinstance(categories, list):
        raise CatalogSmokeError("categorias retornou items inválido")

    expected_total: int | None = None
    expected_by_category: dict[str, int] = {}
    for category in categories:
        if not isinstance(category, dict):
            raise CatalogSmokeError("categorias contém item inválido")
        category_id = str(category.get("id") or "").strip()
        if not category_id:
            raise CatalogSmokeError("categoria sem id")
        try:
            count = int(category.get("count"))
        except (TypeError, ValueError) as exc:
            raise CatalogSmokeError(f"categoria {category_id!r} possui count inválido") from exc
        if category_id == "all":
            expected_total = count
        else:
            expected_by_category[category_id] = count
    if expected_total is None:
        raise CatalogSmokeError("categorias não informa a contagem total 'all'")

    all_items: list[dict[str, Any]] = []
    cursor: str | None = None
    seen_cursors: set[str] = set()
    pages = 0

    while True:
        query: dict[str, str | int] = {"limit": page_limit}
        if cursor:
            query["cursor"] = cursor
        page_url = f"{api_base}/api/catalog?{urllib.parse.urlencode(query)}"
        page = request_json(opener, page_url, f"catálogo página {pages + 1}")
        items = page.get("items")
        if not isinstance(items, list):
            raise CatalogSmokeError(f"catálogo página {pages + 1} retornou items inválido")
        for item in items:
            if not isinstance(item, dict):
                raise CatalogSmokeError(f"catálogo página {pages + 1} contém item inválido")
            all_items.append(item)

        pages += 1
        if pages > max_pages:
            raise CatalogSmokeError(f"catálogo excedeu o limite de {max_pages} páginas")

        raw_cursor = page.get("nextCursor")
        if raw_cursor in (None, ""):
            break
        next_cursor = str(raw_cursor)
        if next_cursor in seen_cursors:
            raise CatalogSmokeError("paginação do catálogo entrou em ciclo")
        seen_cursors.add(next_cursor)
        cursor = next_cursor

    ids = [str(item.get("id") or "").strip() for item in all_items]
    slugs = [str(item.get("slug") or "").strip() for item in all_items]
    codes = [str(item.get("code") or "").strip() for item in all_items]
    missing_ids = sum(not value for value in ids)
    missing_slugs = sum(not value for value in slugs)
    missing_codes = sum(not value for value in codes)
    duplicate_ids = duplicate_values([value for value in ids if value])
    duplicate_slugs = duplicate_values([value for value in slugs if value])
    duplicate_codes = duplicate_values([value for value in codes if value])
    missing_covers = sum(not str(item.get("cover_storage_key") or "").strip() for item in all_items)

    zero_images = 0
    actual_by_category: dict[str, int] = {}
    for item in all_items:
        try:
            image_count = int(item.get("image_count") or 0)
        except (TypeError, ValueError):
            image_count = 0
        if image_count <= 0:
            zero_images += 1
        category_id = str(item.get("category_slug") or "").strip()
        actual_by_category[category_id] = actual_by_category.get(category_id, 0) + 1

    category_mismatches = [
        {
            "category": category_id,
            "expected": expected_count,
            "actual": actual_by_category.get(category_id, 0),
        }
        for category_id, expected_count in sorted(expected_by_category.items())
        if actual_by_category.get(category_id, 0) != expected_count
    ]
    unknown_categories = sorted(
        category_id
        for category_id in actual_by_category
        if category_id and category_id not in expected_by_category
    )

    problems: list[str] = []
    if len(all_items) != expected_total:
        problems.append(f"total publicado {len(all_items)} != esperado {expected_total}")
    if missing_ids:
        problems.append(f"{missing_ids} modelos sem id")
    if missing_slugs:
        problems.append(f"{missing_slugs} modelos sem slug")
    if missing_codes:
        problems.append(f"{missing_codes} modelos sem code")
    if duplicate_ids:
        problems.append(f"{len(duplicate_ids)} ids duplicados")
    if duplicate_slugs:
        problems.append(f"{len(duplicate_slugs)} slugs duplicados")
    if duplicate_codes:
        problems.append(f"{len(duplicate_codes)} codes duplicados")
    if missing_covers:
        problems.append(f"{missing_covers} modelos sem cover_storage_key")
    if zero_images:
        problems.append(f"{zero_images} modelos sem imagens")
    if category_mismatches:
        problems.append(f"{len(category_mismatches)} contagens de categoria divergentes")
    if unknown_categories:
        problems.append(f"{len(unknown_categories)} categorias desconhecidas no catálogo")

    if problems:
        raise CatalogSmokeError("auditoria exaustiva falhou: " + "; ".join(problems))

    return {
        "ok": True,
        "exhaustive": True,
        "pages": pages,
        "totalItems": len(all_items),
        "expectedTotal": expected_total,
        "uniqueIds": len(set(ids)),
        "uniqueSlugs": len(set(slugs)),
        "uniqueCodes": len(set(codes)),
        "missingCoverCount": missing_covers,
        "zeroImageCount": zero_images,
        "categoryCount": len(expected_by_category),
        "categoryMismatchCount": len(category_mismatches),
    }


def configured_value(cli_value: str | None, *env_names: str) -> str:
    if cli_value:
        return cli_value
    for name in env_names:
        value = os.environ.get(name, "").strip()
        if value:
            return value
    return ""


def main() -> int:
    parser = argparse.ArgumentParser(description="Valida o catálogo público e sua mídia.")
    parser.add_argument("--api-base", help="origem pública da API")
    parser.add_argument("--media-base", help="origem pública/CDN da mídia")
    parser.add_argument(
        "--exhaustive",
        action="store_true",
        help="percorre todos os modelos e valida unicidade, capas, imagens e contagens por categoria",
    )
    args = parser.parse_args()

    api_base = configured_value(args.api_base, "CATALOG_API_URL", "VITE_API_BASE_URL")
    media_base = configured_value(args.media_base, "CATALOG_MEDIA_URL", "VITE_MEDIA_BASE_URL")
    if not api_base or not media_base:
        print("ERRO: --api-base/--media-base ou variáveis equivalentes são obrigatórias", file=sys.stderr)
        return 2

    try:
        summary = verify_public_catalog(api_base, media_base)
        if args.exhaustive:
            summary["exhaustiveAudit"] = verify_public_catalog_exhaustive(api_base)
    except CatalogSmokeError as exc:
        print(f"ERRO: {exc}", file=sys.stderr)
        return 2

    print(json.dumps(summary, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    sys.exit(main())
