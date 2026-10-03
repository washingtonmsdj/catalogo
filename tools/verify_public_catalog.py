#!/usr/bin/env python3
"""Verify that the public catalog exposes at least one real model and image.

This is intentionally read-only. It verifies API health, requires a published
catalog row, and then proves that the model's cover object is actually served
by the configured public media origin.
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


def configured_value(cli_value: str | None, *env_names: str) -> str:
    if cli_value:
        return cli_value
    for name in env_names:
        value = os.environ.get(name, "").strip()
        if value:
            return value
    return ""


def main() -> int:
    parser = argparse.ArgumentParser(description="Valida API + primeira imagem do catálogo público.")
    parser.add_argument("--api-base", help="origem pública da API")
    parser.add_argument("--media-base", help="origem pública/CDN da mídia")
    args = parser.parse_args()

    api_base = configured_value(args.api_base, "CATALOG_API_URL", "VITE_API_BASE_URL")
    media_base = configured_value(args.media_base, "CATALOG_MEDIA_URL", "VITE_MEDIA_BASE_URL")
    if not api_base or not media_base:
        print("ERRO: --api-base/--media-base ou variáveis equivalentes são obrigatórias", file=sys.stderr)
        return 2

    try:
        summary = verify_public_catalog(api_base, media_base)
    except CatalogSmokeError as exc:
        print(f"ERRO: {exc}", file=sys.stderr)
        return 2

    print(json.dumps(summary, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    sys.exit(main())
