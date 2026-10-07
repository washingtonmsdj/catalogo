#!/usr/bin/env python3
"""Incrementally backfill model_image_sources from published gallery manifests.

Dry-run mode only measures coverage. Apply mode fetches JSON manifests only;
image binaries are never downloaded. The process is keyset-paginated,
idempotent and also covers unpublished source models attached to a published
canonical gallery.
"""
from __future__ import annotations

import argparse
import concurrent.futures
import json
import os
import re
import sys
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path
from typing import Any

from catalog_schema_contract import (
    load_schema_contract,
    schema_migrations_statement,
    validate_applied_migrations,
)


def require_env(name: str) -> str:
    value = os.environ.get(name, "").strip()
    if not value:
        raise RuntimeError(f"variável obrigatória ausente: {name}")
    return value


def d1_request(statements: list[dict[str, Any]]) -> list[dict[str, Any]]:
    if not statements:
        return []
    account_id = require_env("CLOUDFLARE_ACCOUNT_ID")
    database_id = require_env("CLOUDFLARE_D1_DATABASE_ID")
    token = require_env("CLOUDFLARE_API_TOKEN")
    url = (
        "https://api.cloudflare.com/client/v4/accounts/"
        f"{account_id}/d1/database/{database_id}/query"
    )
    request = urllib.request.Request(
        url,
        data=json.dumps({"batch": statements}).encode("utf-8"),
        method="POST",
        headers={
            "Authorization": f"Bearer {token}",
            "Content-Type": "application/json",
            "User-Agent": "tonecos-catalog-image-source-backfill/1",
        },
    )
    try:
        with urllib.request.urlopen(request, timeout=60) as response:
            body = json.loads(response.read().decode("utf-8"))
    except urllib.error.HTTPError as exc:
        detail = exc.read().decode("utf-8", errors="replace")
        raise RuntimeError(f"D1 HTTP {exc.code}: {detail}") from exc
    if body.get("success") is not True:
        raise RuntimeError(f"D1 recusou operação: {body.get('errors')}")
    result = body.get("result")
    if not isinstance(result, list):
        raise RuntimeError("resposta D1 sem lista result")
    for item in result:
        if not isinstance(item, dict) or item.get("success") is not True:
            raise RuntimeError(f"statement D1 falhou: {item!r}")
    return result


def require_schema_ready() -> dict[str, Any]:
    contract = load_schema_contract()
    result = d1_request([schema_migrations_statement(contract)])
    rows = result[0].get("results")
    if not isinstance(rows, list):
        raise RuntimeError("preflight de schema retornou results inválido")
    return validate_applied_migrations(
        contract,
        [row for row in rows if isinstance(row, dict)],
    )


def coverage_statement() -> dict[str, Any]:
    return {
        "sql": """SELECT
COUNT(*) AS scoped_models,
SUM(CASE WHEN EXISTS (
  SELECT 1 FROM model_image_sources s
  WHERE s.model_id=m.id AND s.gallery_version=m.gallery_version
) THEN 1 ELSE 0 END) AS indexed_models
FROM models m
WHERE m.published=1
   OR EXISTS (
     SELECT 1
     FROM model_gallery_members member
     JOIN models canonical ON canonical.id=member.canonical_model_id
     WHERE member.source_model_id=m.id
       AND canonical.published=1
   )""",
        "params": [],
    }


def missing_page_statement(after_id: str, limit: int) -> dict[str, Any]:
    if limit < 1 or limit > 200:
        raise ValueError("page-size deve ficar entre 1 e 200")
    return {
        "sql": """SELECT
m.id,m.slug,m.image_count,m.gallery_version,m.gallery_manifest_key
FROM models m
WHERE m.id>?
  AND (
    m.published=1
    OR EXISTS (
      SELECT 1
      FROM model_gallery_members member
      JOIN models canonical ON canonical.id=member.canonical_model_id
      WHERE member.source_model_id=m.id
        AND canonical.published=1
    )
  )
  AND NOT EXISTS (
    SELECT 1
    FROM model_image_sources s
    WHERE s.model_id=m.id
      AND s.gallery_version=m.gallery_version
  )
ORDER BY m.id
LIMIT ?""",
        "params": [after_id, limit],
    }


def safe_manifest_key(value: Any, model_id: str) -> str:
    key = str(value or "").strip()
    expected = f"gallery/{model_id}/"
    if (
        not key.startswith(expected)
        or key.startswith("/")
        or "\\" in key
        or ".." in key.split("/")
        or not key.endswith(".json")
    ):
        raise RuntimeError(f"gallery_manifest_key insegura para {model_id}: {value!r}")
    return key


def validate_manifest(row: dict[str, Any], manifest: Any) -> list[dict[str, Any]]:
    model_id = str(row.get("id") or "").strip()
    if not isinstance(manifest, dict) or str(manifest.get("modelId") or "") != model_id:
        raise RuntimeError(f"manifesto pertence a outro modelo: {model_id}")
    try:
        version = int(manifest.get("version"))
        expected_version = int(row.get("gallery_version"))
        expected_count = int(row.get("image_count"))
    except (TypeError, ValueError) as exc:
        raise RuntimeError(f"metadados de galeria inválidos: {model_id}") from exc
    if version != expected_version:
        raise RuntimeError(f"gallery_version divergente: {model_id}: {version} != {expected_version}")

    images = manifest.get("images")
    if not isinstance(images, list) or len(images) != expected_count or not images:
        raise RuntimeError(f"image_count divergente no manifesto: {model_id}")

    seen_ids: set[str] = set()
    seen_sha: set[str] = set()
    rows: list[dict[str, Any]] = []
    covers = 0
    for position, image in enumerate(images):
        if not isinstance(image, dict):
            raise RuntimeError(f"imagem inválida no manifesto: {model_id}")
        image_id = str(image.get("id") or "").strip()
        role = str(image.get("role") or "").strip()
        sha = str(image.get("sourceSha256") or "").strip().lower()
        if not image_id or image_id in seen_ids:
            raise RuntimeError(f"image_id vazio/duplicado: {model_id}")
        if role not in {"cover", "gallery"}:
            raise RuntimeError(f"role inválido: {model_id}/{image_id}")
        if not re.fullmatch(r"[0-9a-f]{64}", sha):
            raise RuntimeError(f"sourceSha256 inválido: {model_id}/{image_id}")
        if sha in seen_sha:
            raise RuntimeError(f"SHA-256 duplicado na mesma galeria: {model_id}/{sha}")
        if role == "cover":
            covers += 1
        if position == 0 and role != "cover":
            raise RuntimeError(f"primeira imagem não é capa: {model_id}")
        seen_ids.add(image_id)
        seen_sha.add(sha)
        rows.append({
            "model_id": model_id,
            "image_id": image_id,
            "position": position,
            "role": role,
            "source_sha256": sha,
            "gallery_version": version,
        })
    if covers != 1:
        raise RuntimeError(f"manifesto deve possuir exatamente uma capa: {model_id}")
    return rows


def source_statements(images: list[dict[str, Any]]) -> list[dict[str, Any]]:
    if not images:
        raise RuntimeError("não é permitido sincronizar manifesto vazio")
    model_id = str(images[0]["model_id"])
    gallery_version = int(images[0]["gallery_version"])
    if any(str(item["model_id"]) != model_id or int(item["gallery_version"]) != gallery_version for item in images):
        raise RuntimeError("lote mistura modelos/versões")
    statements = []
    for image in images:
        statements.append({
            "sql": """INSERT INTO model_image_sources(
model_id,image_id,position,role,source_sha256,gallery_version)
VALUES(?,?,?,?,?,?)
ON CONFLICT(model_id,image_id) DO UPDATE SET
position=excluded.position,role=excluded.role,source_sha256=excluded.source_sha256,
gallery_version=excluded.gallery_version""",
            "params": [
                image["model_id"],
                image["image_id"],
                image["position"],
                image["role"],
                image["source_sha256"],
                image["gallery_version"],
            ],
        })
    statements.append({
        "sql": "DELETE FROM model_image_sources WHERE model_id=? AND gallery_version<>?",
        "params": [model_id, gallery_version],
    })
    return statements


def manifest_url(media_base: str, key: str) -> str:
    base = media_base.rstrip("/")
    encoded = "/".join(urllib.parse.quote(part, safe="") for part in key.split("/"))
    return f"{base}/{encoded}"


def fetch_manifest(media_base: str, row: dict[str, Any]) -> tuple[dict[str, Any], list[dict[str, Any]]]:
    model_id = str(row.get("id") or "")
    key = safe_manifest_key(row.get("gallery_manifest_key"), model_id)
    request = urllib.request.Request(
        manifest_url(media_base, key),
        headers={
            "Accept": "application/json",
            "User-Agent": "tonecos-catalog-image-source-backfill/1",
        },
    )
    try:
        with urllib.request.urlopen(request, timeout=30) as response:
            manifest = json.loads(response.read().decode("utf-8"))
    except (urllib.error.URLError, json.JSONDecodeError) as exc:
        raise RuntimeError(f"falha ao ler manifesto público {key}: {exc}") from exc
    return row, validate_manifest(row, manifest)


def apply_statement_batches(statements: list[dict[str, Any]], batch_size: int = 100) -> int:
    if batch_size < 1 or batch_size > 250:
        raise ValueError("batch_size deve ficar entre 1 e 250")
    batches = 0
    for start in range(0, len(statements), batch_size):
        d1_request(statements[start:start + batch_size])
        batches += 1
    return batches


def coverage() -> dict[str, int]:
    result = d1_request([coverage_statement()])
    rows = result[0].get("results")
    if not isinstance(rows, list) or len(rows) != 1:
        raise RuntimeError("consulta de cobertura retornou formato inesperado")
    scoped = int(rows[0].get("scoped_models") or 0)
    indexed = int(rows[0].get("indexed_models") or 0)
    return {
        "scopedModels": scoped,
        "indexedModels": indexed,
        "missingModels": max(0, scoped - indexed),
    }


def fetch_missing_page(after_id: str, page_size: int) -> list[dict[str, Any]]:
    result = d1_request([missing_page_statement(after_id, page_size)])
    rows = result[0].get("results")
    if not isinstance(rows, list):
        raise RuntimeError("consulta de pendências retornou formato inesperado")
    return [row for row in rows if isinstance(row, dict)]


def duplicate_sha_sample(limit: int = 50) -> list[dict[str, Any]]:
    result = d1_request([{
        "sql": """SELECT
s.source_sha256,
COUNT(DISTINCT COALESCE(member.canonical_model_id,s.model_id)) AS model_count,
GROUP_CONCAT(DISTINCT COALESCE(member.canonical_model_id,s.model_id)) AS model_ids
FROM model_image_sources s
JOIN models source ON source.id=s.model_id AND source.gallery_version=s.gallery_version
LEFT JOIN model_gallery_members member ON member.source_model_id=source.id
JOIN models effective ON effective.id=COALESCE(member.canonical_model_id,source.id)
WHERE effective.published=1
GROUP BY s.source_sha256
HAVING COUNT(DISTINCT COALESCE(member.canonical_model_id,s.model_id))>1
ORDER BY model_count DESC,s.source_sha256
LIMIT ?""",
        "params": [limit],
    }])
    rows = result[0].get("results")
    return [row for row in rows if isinstance(row, dict)] if isinstance(rows, list) else []


def main() -> int:
    parser = argparse.ArgumentParser(description="Mede/preenche índice SHA de manifests publicados.")
    parser.add_argument("--apply", action="store_true", help="preenche metadados ausentes; padrão é somente leitura")
    parser.add_argument("--page-size", type=int, default=50)
    parser.add_argument("--workers", type=int, default=8)
    args = parser.parse_args()
    if not 1 <= args.page_size <= 200:
        parser.error("--page-size deve ficar entre 1 e 200")
    if not 1 <= args.workers <= 16:
        parser.error("--workers deve ficar entre 1 e 16")

    try:
        schema = require_schema_ready()
        before = coverage()
        summary: dict[str, Any] = {"schema": schema, "before": before, "apply": args.apply}
        if not args.apply:
            print(json.dumps(summary, ensure_ascii=False))
            return 0

        media_base = require_env("CATALOG_MEDIA_URL")
        after_id = ""
        indexed_now = 0
        pages = 0
        d1_batches = 0
        while True:
            pending = fetch_missing_page(after_id, args.page_size)
            if not pending:
                break
            pages += 1
            with concurrent.futures.ThreadPoolExecutor(max_workers=args.workers) as executor:
                resolved = list(executor.map(lambda row: fetch_manifest(media_base, row), pending))
            statements: list[dict[str, Any]] = []
            for _row, images in resolved:
                statements.extend(source_statements(images))
                indexed_now += 1
            d1_batches += apply_statement_batches(statements)
            after_id = str(pending[-1].get("id") or "")
            if not after_id:
                raise RuntimeError("paginação não avançou")

        after = coverage()
        if after["missingModels"] != 0:
            raise RuntimeError(f"backfill incompleto: {after['missingModels']} modelo(s) sem índice")
        summary.update({
            "after": after,
            "indexedNow": indexed_now,
            "pages": pages,
            "d1Batches": d1_batches,
            "exactCrossModelCandidates": duplicate_sha_sample(),
            "automaticMerge": False,
            "imageBinariesDownloaded": 0,
            "destructiveDeletes": 0,
        })
        print(json.dumps(summary, ensure_ascii=False))
        return 0
    except RuntimeError as exc:
        print(f"ERRO: {exc}", file=sys.stderr)
        return 2


if __name__ == "__main__":
    sys.exit(main())
