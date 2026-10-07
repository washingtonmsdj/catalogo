#!/usr/bin/env python3
"""Read-only structural integrity audit for the production catalog D1."""
from __future__ import annotations

import json
import sys
from typing import Any

from catalog_schema_contract import (
    load_schema_contract,
    schema_migrations_statement,
    schema_structure_statement,
    validate_applied_migrations,
    validate_schema_structures,
)
from publish_d1 import request_batch_json, require_env


def integrity_queries() -> list[dict[str, Any]]:
    return [
        {
            "name": "category_counts",
            "sql": """SELECT COUNT(*) AS n
FROM categories c
WHERE c.model_count != (
  SELECT COUNT(*)
  FROM models m
  JOIN franchises f ON f.id=m.franchise_id
  WHERE m.published=1 AND f.category_id=c.id
)""",
        },
        {
            "name": "franchise_counts",
            "sql": """SELECT COUNT(*) AS n
FROM franchises f
WHERE f.model_count != (
  SELECT COUNT(*) FROM models m
  WHERE m.published=1 AND m.franchise_id=f.id
)""",
        },
        {
            "name": "folder_direct_counts",
            "sql": """SELECT COUNT(*) AS n
FROM catalog_folders cf
WHERE cf.direct_model_count != (
  SELECT COUNT(*) FROM models m
  WHERE m.published=1 AND m.folder_id=cf.id
)""",
        },
        {
            "name": "folder_subtree_counts",
            "sql": """WITH RECURSIVE tree(root_id,id) AS (
  SELECT id,id FROM catalog_folders
  UNION ALL
  SELECT tree.root_id,child.id
  FROM tree
  JOIN catalog_folders child ON child.parent_id=tree.id
),
actual AS (
  SELECT tree.root_id,COUNT(m.id) AS model_count
  FROM tree
  LEFT JOIN models m ON m.folder_id=tree.id AND m.published=1
  GROUP BY tree.root_id
)
SELECT COUNT(*) AS n
FROM catalog_folders cf
LEFT JOIN actual ON actual.root_id=cf.id
WHERE cf.subtree_model_count != COALESCE(actual.model_count,0)""",
        },
        {
            "name": "folder_roots",
            "sql": """SELECT COUNT(*) AS n
FROM catalog_folders
WHERE parent_id IS NULL
  AND (depth<>1 OR instr(path,'/')>0)""",
        },
        {
            "name": "folder_children",
            "sql": """SELECT COUNT(*) AS n
FROM catalog_folders child
LEFT JOIN catalog_folders parent ON parent.id=child.parent_id
WHERE child.parent_id IS NOT NULL
  AND (
    parent.id IS NULL
    OR child.franchise_id<>parent.franchise_id
    OR child.depth<>parent.depth+1
    OR child.path<>parent.path||'/'||child.slug
  )""",
        },
        {
            "name": "folder_path_depth",
            "sql": """SELECT COUNT(*) AS n
FROM catalog_folders
WHERE depth <> 1 + length(path) - length(replace(path,'/',''))""",
        },
        {
            "name": "model_folder_franchise",
            "sql": """SELECT COUNT(*) AS n
FROM models m
JOIN catalog_folders cf ON cf.id=m.folder_id
WHERE m.franchise_id<>cf.franchise_id""",
        },
        {
            "name": "model_collection_folder_nullability",
            "sql": """SELECT COUNT(*) AS n
FROM models
WHERE (folder_id IS NULL AND trim(collection)<>'')
   OR (folder_id IS NOT NULL AND trim(collection)='')""",
        },
        {
            "name": "published_required_fields",
            "sql": """SELECT COUNT(*) AS n
FROM models
WHERE published=1
  AND (
    trim(id)='' OR trim(slug)='' OR trim(code)='' OR trim(name)=''
    OR image_count<1 OR trim(cover_storage_key)=''
    OR trim(gallery_manifest_key)='' OR gallery_version<1
    OR public_gallery_version<1 OR trim(search_text)=''
  )""",
        },
        {
            "name": "model_id_format",
            "sql": """SELECT COUNT(*) AS n
FROM models
WHERE id NOT LIKE 'mdl_%'
   OR length(id)<>24
   OR substr(id,5) GLOB '*[^0-9a-f]*'""",
        },
        {
            "name": "model_code_format",
            "sql": """SELECT COUNT(*) AS n
FROM models
WHERE substr(code,1,3)<>'TS-'
   OR length(code)<>15
   OR substr(code,4) GLOB '*[^0-9A-F]*'""",
        },
        {
            "name": "model_slug_format",
            "sql": """SELECT COUNT(*) AS n
FROM models
WHERE slug<>lower(slug)
   OR slug LIKE '-%'
   OR slug LIKE '%-'
   OR slug LIKE '%--%'
   OR slug GLOB '*[^a-z0-9-]*'""",
        },
        {
            "name": "models_fts_missing",
            "sql": """SELECT COUNT(*) AS n
FROM models m
WHERE NOT EXISTS (
  SELECT 1 FROM models_fts f WHERE f.model_id=m.id
)""",
        },
        {
            "name": "models_fts_orphans",
            "sql": """SELECT COUNT(*) AS n
FROM models_fts f
WHERE NOT EXISTS (
  SELECT 1 FROM models m WHERE m.id=f.model_id
)""",
        },
        {
            "name": "franchises_fts_missing",
            "sql": """SELECT COUNT(*) AS n
FROM franchises f
WHERE NOT EXISTS (
  SELECT 1 FROM franchises_fts x WHERE x.franchise_id=f.id
)""",
        },
        {
            "name": "franchises_fts_orphans",
            "sql": """SELECT COUNT(*) AS n
FROM franchises_fts x
WHERE NOT EXISTS (
  SELECT 1 FROM franchises f WHERE f.id=x.franchise_id
)""",
        },
        {
            "name": "gallery_relation_state",
            "sql": """SELECT COUNT(*) AS n
FROM model_gallery_members gm
JOIN models canonical ON canonical.id=gm.canonical_model_id
JOIN models source ON source.id=gm.source_model_id
WHERE canonical.published<>1
   OR source.published<>0
   OR canonical.franchise_id<>source.franchise_id
   OR COALESCE(canonical.folder_id,-1)<>COALESCE(source.folder_id,-1)
   OR lower(trim(canonical.name))<>lower(trim(source.name))""",
        },
        {
            "name": "gallery_relation_chains",
            "sql": """SELECT COUNT(*) AS n
FROM model_gallery_members gm
WHERE EXISTS (
  SELECT 1 FROM model_gallery_members other
  WHERE other.canonical_model_id=gm.source_model_id
     OR other.source_model_id=gm.canonical_model_id
)""",
        },
        {
            "name": "image_source_version_drift",
            "sql": """SELECT COUNT(*) AS n
FROM model_image_sources s
JOIN models m ON m.id=s.model_id
WHERE s.gallery_version<>m.gallery_version""",
        },
        {
            "name": "future_created_at",
            "sql": "SELECT COUNT(*) AS n FROM models WHERE created_at>CURRENT_TIMESTAMP",
        },
        {
            "name": "future_updated_at",
            "sql": "SELECT COUNT(*) AS n FROM models WHERE updated_at>CURRENT_TIMESTAMP",
        },
    ]


def metric_queries() -> list[dict[str, Any]]:
    return [
        {"name": "publishedModels", "sql": "SELECT COUNT(*) AS value FROM models WHERE published=1"},
        {"name": "totalModels", "sql": "SELECT COUNT(*) AS value FROM models"},
        {"name": "folders", "sql": "SELECT COUNT(*) AS value FROM catalog_folders"},
        {"name": "franchises", "sql": "SELECT COUNT(*) AS value FROM franchises"},
        {"name": "categories", "sql": "SELECT COUNT(*) AS value FROM categories"},
        {"name": "modelsFtsRows", "sql": "SELECT COUNT(*) AS value FROM models_fts"},
        {"name": "franchisesFtsRows", "sql": "SELECT COUNT(*) AS value FROM franchises_fts"},
        {"name": "galleryRelations", "sql": "SELECT COUNT(*) AS value FROM model_gallery_members"},
        {"name": "indexedImageSources", "sql": "SELECT COUNT(*) AS value FROM model_image_sources"},
    ]


def _extract_single_number(item: dict[str, Any], field: str, label: str) -> int:
    if not isinstance(item, dict) or item.get("success") is not True:
        raise RuntimeError(f"consulta de integridade falhou: {label}: {item!r}")
    rows = item.get("results")
    if not isinstance(rows, list) or len(rows) != 1 or not isinstance(rows[0], dict):
        raise RuntimeError(f"consulta de integridade retornou formato inválido: {label}")
    try:
        return int(rows[0].get(field))
    except (TypeError, ValueError) as exc:
        raise RuntimeError(f"consulta de integridade retornou valor inválido: {label}") from exc


def validate_integrity_results(
    checks: list[dict[str, Any]],
    metrics: list[dict[str, Any]],
    results: list[dict[str, Any]],
) -> dict[str, Any]:
    expected = len(checks) + len(metrics)
    if len(results) != expected:
        raise RuntimeError(
            f"auditoria D1 retornou {len(results)} resultados; esperado={expected}"
        )

    failures: dict[str, int] = {}
    check_summary: dict[str, int] = {}
    for index, query in enumerate(checks):
        count = _extract_single_number(results[index], "n", str(query["name"]))
        check_summary[str(query["name"])] = count
        if count != 0:
            failures[str(query["name"])] = count

    metric_summary: dict[str, int] = {}
    offset = len(checks)
    for index, query in enumerate(metrics):
        metric_summary[str(query["name"])] = _extract_single_number(
            results[offset + index],
            "value",
            str(query["name"]),
        )

    if failures:
        rendered = ", ".join(f"{name}={value}" for name, value in failures.items())
        raise RuntimeError(f"integridade D1 falhou: {rendered}")

    return {
        "ready": True,
        "checks": len(checks),
        "failures": 0,
        "metrics": metric_summary,
    }


def _query(
    account_id: str,
    database_id: str,
    token: str,
    statements: list[dict[str, Any]],
) -> list[dict[str, Any]]:
    body = request_batch_json(account_id, database_id, token, statements)
    result = body.get("result")
    if not isinstance(result, list) or len(result) != len(statements):
        raise RuntimeError("D1 retornou quantidade inesperada de resultados")
    return result


def run_audit(account_id: str, database_id: str, token: str) -> dict[str, Any]:
    contract = load_schema_contract()
    schema_result = _query(
        account_id,
        database_id,
        token,
        [
            schema_migrations_statement(contract),
            schema_structure_statement(contract),
        ],
    )
    migration_rows = schema_result[0].get("results")
    structure_rows = schema_result[1].get("results")
    if not isinstance(migration_rows, list) or not isinstance(structure_rows, list):
        raise RuntimeError("preflight estrutural D1 retornou formato inválido")
    schema = {
        **validate_applied_migrations(
            contract,
            [row for row in migration_rows if isinstance(row, dict)],
        ),
        **validate_schema_structures(
            contract,
            [row for row in structure_rows if isinstance(row, dict)],
        ),
    }

    checks = integrity_queries()
    metrics = metric_queries()
    statements = [
        {"sql": str(item["sql"]), "params": []}
        for item in [*checks, *metrics]
    ]
    results = _query(account_id, database_id, token, statements)
    integrity = validate_integrity_results(checks, metrics, results)
    return {
        "schema": schema,
        **integrity,
    }


def main() -> int:
    try:
        account_id = require_env("CLOUDFLARE_ACCOUNT_ID")
        database_id = require_env("CLOUDFLARE_D1_DATABASE_ID")
        token = require_env("CLOUDFLARE_API_TOKEN")
        result = run_audit(account_id, database_id, token)
        print(json.dumps(result, ensure_ascii=False))
        return 0
    except (OSError, RuntimeError, ValueError) as exc:
        print(f"ERRO: {exc}", file=sys.stderr)
        return 2


if __name__ == "__main__":
    raise SystemExit(main())
