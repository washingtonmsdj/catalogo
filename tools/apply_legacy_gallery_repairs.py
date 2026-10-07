#!/usr/bin/env python3
"""Plan/apply reviewed legacy gallery repairs against production D1.

The operation is intentionally monotonic:
- inserting canonical -> source is the only write;
- database triggers retire the source card in the same statement;
- no DELETE is issued;
- partial progress is safe to rerun because already-correct relations are skipped.
"""
from __future__ import annotations

import argparse
import json
import os
import sys
import urllib.error
import urllib.request
from pathlib import Path
from typing import Any

from catalog_schema_contract import (
    load_schema_contract,
    schema_migrations_statement,
    validate_applied_migrations,
)


def load_config(path: Path) -> list[dict[str, Any]]:
    if not path.is_file():
        raise RuntimeError(f"configuração de reparos não encontrada: {path}")
    try:
        payload = json.loads(path.read_text(encoding="utf-8"))
    except json.JSONDecodeError as exc:
        raise RuntimeError(f"configuração de reparos inválida: {path}: {exc}") from exc
    if not isinstance(payload, dict) or payload.get("version") != 2:
        raise RuntimeError("versão do registro de reparos legados não suportada")
    groups = payload.get("groups")
    if not isinstance(groups, list) or not groups:
        raise RuntimeError("registro de reparos legados vazio")

    seen_members: set[str] = set()
    for index, group in enumerate(groups, 1):
        if not isinstance(group, dict):
            raise RuntimeError(f"grupo de reparo inválido na posição {index}")
        required = ("categorySlug", "franchiseSlug", "folderPathKey", "family", "canonicalSlug", "memberSlugs", "reason")
        if any(not group.get(key) for key in required):
            raise RuntimeError(f"grupo de reparo incompleto na posição {index}")
        members = group["memberSlugs"]
        if not isinstance(members, list) or len(members) < 2:
            raise RuntimeError(f"grupo de reparo sem membros suficientes: {group.get('family')}")
        if group["canonicalSlug"] not in members:
            raise RuntimeError(f"canônico fora dos membros: {group['canonicalSlug']}")
        if len(set(members)) != len(members):
            raise RuntimeError(f"membro repetido no grupo: {group['family']}")
        overlap = seen_members.intersection(members)
        if overlap:
            raise RuntimeError(f"slug aparece em múltiplos grupos: {sorted(overlap)[:5]}")
        seen_members.update(members)
    return groups


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
            "User-Agent": "tonecos-catalog-legacy-gallery-repair/1",
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


def _chunks(values: list[str], size: int = 50):
    for start in range(0, len(values), size):
        yield values[start:start + size]


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


def fetch_state(groups: list[dict[str, Any]]) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
    slugs = sorted({slug for group in groups for slug in group["memberSlugs"]})
    model_rows: list[dict[str, Any]] = []
    relation_rows: list[dict[str, Any]] = []

    for chunk in _chunks(slugs):
        placeholders = ",".join("?" for _ in chunk)
        result = d1_request([{
            "sql": f"""SELECT
m.id,m.slug,m.code,m.name,m.published,m.image_count,m.gallery_version,
m.gallery_manifest_key,m.cover_storage_key,
c.slug AS category_slug,f.slug AS franchise_slug,COALESCE(cf.path,'') AS folder_path
FROM models m
JOIN franchises f ON f.id=m.franchise_id
JOIN categories c ON c.id=f.category_id
LEFT JOIN catalog_folders cf ON cf.id=m.folder_id
WHERE m.slug IN ({placeholders})
ORDER BY m.slug""",
            "params": chunk,
        }])
        rows = result[0].get("results")
        if not isinstance(rows, list):
            raise RuntimeError("consulta de modelos legados retornou results inválido")
        model_rows.extend(row for row in rows if isinstance(row, dict))

        result = d1_request([{
            "sql": f"""SELECT
canonical.slug AS canonical_slug,
source.slug AS source_slug,
member.position
FROM model_gallery_members member
JOIN models canonical ON canonical.id=member.canonical_model_id
JOIN models source ON source.id=member.source_model_id
WHERE canonical.slug IN ({placeholders})
   OR source.slug IN ({placeholders})
ORDER BY canonical.slug,member.position,source.slug""",
            "params": [*chunk, *chunk],
        }])
        rows = result[0].get("results")
        if not isinstance(rows, list):
            raise RuntimeError("consulta de relações legadas retornou results inválido")
        relation_rows.extend(row for row in rows if isinstance(row, dict))

    unique_relations = {
        (str(row.get("canonical_slug")), str(row.get("source_slug"))): row
        for row in relation_rows
    }
    return model_rows, list(unique_relations.values())


def plan_repairs(
    groups: list[dict[str, Any]],
    model_rows: list[dict[str, Any]],
    relation_rows: list[dict[str, Any]],
) -> dict[str, Any]:
    models = {str(row.get("slug") or ""): row for row in model_rows}
    relations_by_source = {
        str(row.get("source_slug") or ""): row
        for row in relation_rows
    }
    expected_members = {slug for group in groups for slug in group["memberSlugs"]}
    if set(models) != expected_members:
        missing = sorted(expected_members.difference(models))
        extra = sorted(set(models).difference(expected_members))
        raise RuntimeError(f"estado D1 divergente do registro: ausentes={missing[:5]} extras={extra[:5]}")

    statements: list[dict[str, Any]] = []
    existing = 0
    sources_to_retire = 0
    expected_relations: list[dict[str, Any]] = []

    for group in groups:
        members = [models[slug] for slug in group["memberSlugs"]]
        canonical_slug = str(group["canonicalSlug"])
        canonical = models[canonical_slug]

        scopes = {
            (
                str(row.get("category_slug") or ""),
                str(row.get("franchise_slug") or ""),
                str(row.get("folder_path") or ""),
                str(row.get("name") or "").strip().casefold(),
            )
            for row in members
        }
        expected_scope = (
            str(group["categorySlug"]),
            str(group["franchiseSlug"]),
            str(group["folderPathKey"]),
        )
        if len(scopes) != 1:
            raise RuntimeError(f"membros divergem de escopo/nome: {group['family']}")
        scope = next(iter(scopes))
        if scope[:3] != expected_scope:
            raise RuntimeError(
                f"escopo D1 diverge do registro {group['family']}: {scope[:3]} != {expected_scope}"
            )
        if int(canonical.get("published") or 0) != 1:
            raise RuntimeError(f"modelo canônico não está publicado: {canonical_slug}")

        for row in members:
            slug = str(row["slug"])
            if int(row.get("image_count") or 0) != 1:
                raise RuntimeError(f"ficha legada deixou de ter image_count=1: {slug}")
            if int(row.get("gallery_version") or 0) < 1:
                raise RuntimeError(f"gallery_version inválida: {slug}")
            if not str(row.get("gallery_manifest_key") or "").strip():
                raise RuntimeError(f"manifesto ausente: {slug}")
            if not str(row.get("cover_storage_key") or "").strip():
                raise RuntimeError(f"capa ausente: {slug}")

        source_slugs = [slug for slug in group["memberSlugs"] if slug != canonical_slug]
        for position, source_slug in enumerate(source_slugs, 1):
            relation = relations_by_source.get(source_slug)
            expected_relations.append({
                "canonicalSlug": canonical_slug,
                "sourceSlug": source_slug,
                "position": position,
            })
            if relation is not None:
                if str(relation.get("canonical_slug")) != canonical_slug:
                    raise RuntimeError(
                        f"fonte já pertence a outro canônico: {source_slug} -> "
                        f"{relation.get('canonical_slug')}"
                    )
                if int(relation.get("position") or -1) != position:
                    raise RuntimeError(
                        f"posição existente diverge do registro: {source_slug}: "
                        f"{relation.get('position')} != {position}"
                    )
                if int(models[source_slug].get("published") or 0) != 0:
                    raise RuntimeError(f"fonte anexada continua publicada: {source_slug}")
                existing += 1
                continue

            if int(models[source_slug].get("published") or 0) != 1:
                raise RuntimeError(
                    f"fonte não publicada sem relação canônica registrada: {source_slug}"
                )
            sources_to_retire += 1
            statements.append({
                "sql": """INSERT INTO model_gallery_members(
canonical_model_id,source_model_id,position)
SELECT canonical.id,source.id,?
FROM models canonical
JOIN models source ON source.slug=?
WHERE canonical.slug=?""",
                "params": [position, source_slug, canonical_slug],
            })

    expected_sources = {item["sourceSlug"] for item in expected_relations}
    unexpected = [
        row for row in relation_rows
        if str(row.get("source_slug") or "") in expected_members
        and str(row.get("source_slug") or "") not in expected_sources
    ]
    if unexpected:
        raise RuntimeError(f"relações inesperadas envolvendo o registro legado: {unexpected[:3]}")

    return {
        "ready": True,
        "groups": len(groups),
        "memberCards": len(expected_members),
        "expectedRelations": len(expected_relations),
        "existingRelations": existing,
        "pendingRelations": len(statements),
        "sourcesToRetire": sources_to_retire,
        "destructiveDeletes": 0,
        "statements": statements,
        "expected": expected_relations,
    }


def apply_statement_batches(
    statements: list[dict[str, Any]],
    batch_size: int = 100,
) -> int:
    if batch_size < 1 or batch_size > 250:
        raise ValueError("batch_size deve ficar entre 1 e 250")
    batches = 0
    for start in range(0, len(statements), batch_size):
        d1_request(statements[start:start + batch_size])
        batches += 1
    return batches


def published_model_count() -> int:
    result = d1_request([{
        "sql": "SELECT COUNT(*) AS total FROM models WHERE published=1",
        "params": [],
    }])
    rows = result[0].get("results")
    if not isinstance(rows, list) or len(rows) != 1:
        raise RuntimeError("contagem de modelos públicos retornou formato inválido")
    return int(rows[0].get("total") or 0)


def count_integrity_statements() -> list[dict[str, Any]]:
    return [
        {
            "name": "categories",
            "sql": """SELECT COUNT(*) AS mismatches
FROM categories c
WHERE c.model_count != (
  SELECT COUNT(*)
  FROM models m
  JOIN franchises f ON f.id=m.franchise_id
  WHERE m.published=1 AND f.category_id=c.id
)""",
            "params": [],
        },
        {
            "name": "franchises",
            "sql": """SELECT COUNT(*) AS mismatches
FROM franchises f
WHERE f.model_count != (
  SELECT COUNT(*)
  FROM models m
  WHERE m.published=1 AND m.franchise_id=f.id
)""",
            "params": [],
        },
        {
            "name": "folders_direct",
            "sql": """SELECT COUNT(*) AS mismatches
FROM catalog_folders cf
WHERE cf.direct_model_count != (
  SELECT COUNT(*)
  FROM models m
  WHERE m.published=1 AND m.folder_id=cf.id
)""",
            "params": [],
        },
        {
            "name": "folders_subtree",
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
SELECT COUNT(*) AS mismatches
FROM catalog_folders cf
LEFT JOIN actual ON actual.root_id=cf.id
WHERE cf.subtree_model_count != COALESCE(actual.model_count,0)""",
            "params": [],
        },
    ]


def verify_materialized_counts() -> dict[str, Any]:
    specs = count_integrity_statements()
    result = d1_request([
        {"sql": item["sql"], "params": item["params"]}
        for item in specs
    ])
    if len(result) != len(specs):
        raise RuntimeError("verificação de contadores retornou quantidade inesperada de resultados")
    summary: dict[str, int] = {}
    for spec, item in zip(specs, result):
        rows = item.get("results")
        if not isinstance(rows, list) or len(rows) != 1:
            raise RuntimeError(f"verificação de contador inválida: {spec['name']}")
        mismatches = int(rows[0].get("mismatches") or 0)
        summary[str(spec["name"])] = mismatches
        if mismatches:
            raise RuntimeError(
                f"contador materializado divergente após reparo: {spec['name']}={mismatches}"
            )
    return {
        "ready": True,
        "mismatches": summary,
    }


def verify_applied(
    groups: list[dict[str, Any]],
    model_rows: list[dict[str, Any]],
    relation_rows: list[dict[str, Any]],
) -> dict[str, Any]:
    plan = plan_repairs(groups, model_rows, relation_rows)
    if plan["pendingRelations"] != 0:
        raise RuntimeError(f"reparo incompleto após aplicação: {plan['pendingRelations']} relação(ões) pendente(s)")
    expected_canonicals = {group["canonicalSlug"] for group in groups}
    models = {str(row["slug"]): row for row in model_rows}
    for group in groups:
        for slug in group["memberSlugs"]:
            expected = 1 if slug in expected_canonicals else 0
            if int(models[slug].get("published") or 0) != expected:
                raise RuntimeError(f"estado published pós-reparo inválido: {slug}")
    return {
        "ready": True,
        "groups": len(groups),
        "relations": plan["expectedRelations"],
        "publishedCanonicals": len(expected_canonicals),
        "retiredSources": plan["expectedRelations"],
        "destructiveDeletes": 0,
    }


def main() -> int:
    parser = argparse.ArgumentParser(description="Planeja/aplica reparos legados de galeria no D1.")
    parser.add_argument(
        "--config",
        type=Path,
        default=Path(__file__).resolve().parents[1] / "config" / "catalog-legacy-gallery-overrides.json",
    )
    parser.add_argument("--apply", action="store_true", help="aplica as relações pendentes; padrão é somente leitura")
    parser.add_argument("--batch-size", type=int, default=100)
    args = parser.parse_args()
    if not 1 <= args.batch_size <= 250:
        parser.error("--batch-size deve ficar entre 1 e 250")

    try:
        groups = load_config(args.config)
        schema = require_schema_ready()
        models, relations = fetch_state(groups)
        plan = plan_repairs(groups, models, relations)
        public_models_before = published_model_count()
        public_summary = {key: value for key, value in plan.items() if key not in {"statements", "expected"}}
        public_summary["schema"] = schema
        public_summary["publicModelsBefore"] = public_models_before
        public_summary["expectedPublicModelsAfter"] = public_models_before - int(plan["sourcesToRetire"])
        public_summary["apply"] = args.apply
        if not args.apply:
            print(json.dumps(public_summary, ensure_ascii=False))
            return 0

        batches = apply_statement_batches(plan["statements"], args.batch_size)
        models, relations = fetch_state(groups)
        result = verify_applied(groups, models, relations)
        public_models_after = published_model_count()
        expected_public_models_after = public_models_before - int(plan["sourcesToRetire"])
        if public_models_after != expected_public_models_after:
            raise RuntimeError(
                "quantidade pública mudou além das fontes aposentadas: "
                f"{public_models_before} -> {public_models_after}; "
                f"esperado={expected_public_models_after}"
            )
        result["schema"] = schema
        result["publicModelsBefore"] = public_models_before
        result["publicModelsAfter"] = public_models_after
        result["expectedPublicModelsAfter"] = expected_public_models_after
        result["materializedCounts"] = verify_materialized_counts()
        result["batches"] = batches
        result["apply"] = True
        print(json.dumps(result, ensure_ascii=False))
        return 0
    except RuntimeError as exc:
        print(f"ERRO: {exc}", file=sys.stderr)
        return 2


if __name__ == "__main__":
    sys.exit(main())
