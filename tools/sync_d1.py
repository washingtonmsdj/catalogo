#!/usr/bin/env python3
"""Synchronize models.jsonl into Cloudflare D1 incrementally.

The local checkpoint is committed only after Wrangler reports a successful
remote import. Unchanged models generate no writes. Removed source-managed
models are unpublished/tombstoned rather than deleted so quote history and
foreign-key references remain intact.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import math
import os
import shutil
import subprocess
import sys
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Iterable

STATE_VERSION = 1
REMOVAL_RATIO_LIMIT = 0.10
REMOVAL_ABSOLUTE_FLOOR = 50
ID_CHUNK_SIZE = 50

REQUIRED_FIELDS = {
    "id": str,
    "slug": str,
    "code": str,
    "sourceHierarchy": list,
    "categoryName": str,
    "categorySlug": str,
    "franchiseName": str,
    "franchiseSlug": str,
    "displayName": str,
    "collection": str,
    "searchText": str,
    "imageCount": int,
    "coverStorageKey": str,
    "galleryManifestKey": str,
    "galleryVersion": int,
}

FINGERPRINT_FIELDS = tuple(REQUIRED_FIELDS)


@dataclass(frozen=True)
class SyncPlan:
    sync_id: str
    source_sha256: str
    total_models: int
    changed: tuple[dict[str, Any], ...]
    removed_ids: tuple[str, ...]
    moving_ids: tuple[str, ...]
    next_state: dict[str, Any]

    @property
    def changed_count(self) -> int:
        return len(self.changed)

    @property
    def removed_count(self) -> int:
        return len(self.removed_ids)

    @property
    def has_remote_changes(self) -> bool:
        return bool(self.changed or self.removed_ids)


def sha256_bytes(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def stable_json(value: Any) -> bytes:
    return json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":")).encode("utf-8")


def sql_text(value: str) -> str:
    return "'" + value.replace("'", "''") + "'"


def sql_nullable_text(value: str | None) -> str:
    return "NULL" if value is None or value == "" else sql_text(value)


def chunked(items: list[str], size: int = ID_CHUNK_SIZE) -> Iterable[list[str]]:
    for index in range(0, len(items), size):
        yield items[index:index + size]


def default_state() -> dict[str, Any]:
    return {"version": STATE_VERSION, "source_sha256": None, "models": {}}


def load_state(path: Path) -> dict[str, Any]:
    if not path.exists():
        return default_state()
    try:
        state = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        raise RuntimeError(f"checkpoint D1 inválido: {path}: {exc}") from exc
    if state.get("version") != STATE_VERSION or not isinstance(state.get("models"), dict):
        raise RuntimeError(f"versão de checkpoint D1 incompatível: {path}")
    return state


def save_state(path: Path, state: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_suffix(path.suffix + ".tmp")
    temporary.write_text(json.dumps(state, ensure_ascii=False, sort_keys=True, indent=2) + "\n", encoding="utf-8")
    os.replace(temporary, path)


def validate_model(row: dict[str, Any], line_number: int) -> dict[str, Any]:
    for field, expected_type in REQUIRED_FIELDS.items():
        value = row.get(field)
        if not isinstance(value, expected_type):
            raise ValueError(f"linha {line_number}: {field} deve ser {expected_type.__name__}")
    if not row["id"].startswith("mdl_") or len(row["id"]) > 80:
        raise ValueError(f"linha {line_number}: id de modelo inválido")
    if not row["slug"] or len(row["slug"]) > 240:
        raise ValueError(f"linha {line_number}: slug inválido")
    if not row["code"] or len(row["code"]) > 80:
        raise ValueError(f"linha {line_number}: código inválido")
    if not row["sourceHierarchy"] or not all(isinstance(item, str) and item.strip() for item in row["sourceHierarchy"]):
        raise ValueError(f"linha {line_number}: sourceHierarchy inválida")
    if row["imageCount"] < 1:
        raise ValueError(f"linha {line_number}: modelo sem imagens canônicas")
    if row["galleryVersion"] < 1:
        raise ValueError(f"linha {line_number}: galleryVersion inválida")
    if not row["coverStorageKey"].startswith("media/"):
        raise ValueError(f"linha {line_number}: coverStorageKey inválida")
    if not row["galleryManifestKey"].startswith("gallery/"):
        raise ValueError(f"linha {line_number}: galleryManifestKey inválida")
    return row


def read_models(path: Path) -> tuple[list[dict[str, Any]], str]:
    raw = path.read_bytes()
    source_sha = sha256_bytes(raw)
    rows: list[dict[str, Any]] = []
    for line_number, line in enumerate(raw.decode("utf-8").splitlines(), 1):
        if not line.strip():
            continue
        try:
            parsed = json.loads(line)
        except json.JSONDecodeError as exc:
            raise ValueError(f"linha {line_number}: JSON inválido: {exc}") from exc
        if not isinstance(parsed, dict):
            raise ValueError(f"linha {line_number}: objeto JSON esperado")
        rows.append(validate_model(parsed, line_number))

    ids: set[str] = set()
    slugs: set[str] = set()
    codes: set[str] = set()
    categories: dict[str, str] = {}
    franchises: dict[tuple[str, str], str] = {}
    for row in rows:
        if row["id"] in ids:
            raise ValueError(f"id duplicado: {row['id']}")
        if row["slug"] in slugs:
            raise ValueError(f"slug duplicado: {row['slug']}")
        if row["code"] in codes:
            raise ValueError(f"código duplicado: {row['code']}")
        ids.add(row["id"])
        slugs.add(row["slug"])
        codes.add(row["code"])

        category_slug = row["categorySlug"]
        category_name = row["categoryName"]
        if category_slug in categories and categories[category_slug] != category_name:
            raise ValueError(f"categoria inconsistente para slug {category_slug}")
        categories[category_slug] = category_name

        franchise_key = (category_slug, row["franchiseSlug"])
        if franchise_key in franchises and franchises[franchise_key] != row["franchiseName"]:
            raise ValueError(f"franquia inconsistente: {franchise_key}")
        franchises[franchise_key] = row["franchiseName"]

    rows.sort(key=lambda row: (row["displayName"].casefold(), row["id"]))
    return rows, source_sha


def model_fingerprint(row: dict[str, Any]) -> str:
    data = {field: row[field] for field in FINGERPRINT_FIELDS}
    return sha256_bytes(stable_json(data))


def build_plan(rows: list[dict[str, Any]], source_sha: str, previous_state: dict[str, Any]) -> SyncPlan:
    old_models = previous_state.get("models", {})
    current: dict[str, dict[str, Any]] = {}
    changed: list[dict[str, Any]] = []
    moving_ids: list[str] = []

    for row in rows:
        fingerprint = model_fingerprint(row)
        previous = old_models.get(row["id"])
        current[row["id"]] = {
            "fingerprint": fingerprint,
            "slug": row["slug"],
            "code": row["code"],
        }
        if not previous or previous.get("fingerprint") != fingerprint:
            changed.append(row)
            if previous and (previous.get("slug") != row["slug"] or previous.get("code") != row["code"]):
                moving_ids.append(row["id"])

    removed_ids = sorted(set(old_models) - set(current))
    sync_id = f"sync_{source_sha[:24]}"
    next_state = {
        "version": STATE_VERSION,
        "source_sha256": source_sha,
        "models": current,
    }
    return SyncPlan(
        sync_id=sync_id,
        source_sha256=source_sha,
        total_models=len(rows),
        changed=tuple(changed),
        removed_ids=tuple(removed_ids),
        moving_ids=tuple(sorted(moving_ids)),
        next_state=next_state,
    )


def validate_removal_safety(plan: SyncPlan, previous_state: dict[str, Any], allow_large_removal: bool) -> None:
    old_count = len(previous_state.get("models", {}))
    if old_count == 0 or plan.removed_count == 0 or allow_large_removal:
        return
    limit = max(REMOVAL_ABSOLUTE_FLOOR, math.ceil(old_count * REMOVAL_RATIO_LIMIT))
    if plan.removed_count > limit:
        raise RuntimeError(
            f"bloqueio de segurança: {plan.removed_count}/{old_count} modelos desapareceram; "
            f"limite automático={limit}. Revise a origem ou use --allow-large-removal conscientemente."
        )


def ids_sql(ids: Iterable[str]) -> str:
    return ",".join(sql_text(value) for value in ids)


def category_statements(changed: tuple[dict[str, Any], ...]) -> list[str]:
    categories: dict[str, str] = {}
    for row in changed:
        categories[row["categorySlug"]] = row["categoryName"]
    return [
        "INSERT INTO categories(slug,name) VALUES(" + sql_text(slug) + "," + sql_text(name) + ") "
        "ON CONFLICT(slug) DO UPDATE SET name=excluded.name;"
        for slug, name in sorted(categories.items())
    ]


def franchise_statements(changed: tuple[dict[str, Any], ...]) -> list[str]:
    franchises: dict[tuple[str, str], str] = {}
    for row in changed:
        franchises[(row["categorySlug"], row["franchiseSlug"])] = row["franchiseName"]
    statements = []
    for (category_slug, franchise_slug), name in sorted(franchises.items()):
        statements.append(
            "INSERT INTO franchises(category_id,slug,name) VALUES("
            f"(SELECT id FROM categories WHERE slug={sql_text(category_slug)}),"
            f"{sql_text(franchise_slug)},{sql_text(name)}) "
            "ON CONFLICT(category_id,slug) DO UPDATE SET name=excluded.name;"
        )
    return statements


def model_statement(row: dict[str, Any], sync_id: str) -> str:
    source_key = " / ".join(row["sourceHierarchy"])
    franchise_id = (
        "(SELECT f.id FROM franchises f JOIN categories c ON c.id=f.category_id "
        f"WHERE c.slug={sql_text(row['categorySlug'])} AND f.slug={sql_text(row['franchiseSlug'])} LIMIT 1)"
    )
    values = [
        sql_text(row["id"]),
        franchise_id,
        sql_text(row["slug"]),
        sql_text(row["code"]),
        sql_text(row["displayName"]),
        sql_nullable_text(row["collection"]),
        str(row["imageCount"]),
        sql_text(row["coverStorageKey"]),
        sql_text(row["galleryManifestKey"]),
        str(row["galleryVersion"]),
        "1",
        sql_text(row["searchText"]),
        sql_text(source_key),
        sql_text(sync_id),
        "CURRENT_TIMESTAMP",
    ]
    return (
        "INSERT INTO models("
        "id,franchise_id,slug,code,name,collection,image_count,cover_storage_key,"
        "gallery_manifest_key,gallery_version,published,search_text,source_key,source_sync_id,updated_at"
        ") VALUES(" + ",".join(values) + ") "
        "ON CONFLICT(id) DO UPDATE SET "
        "franchise_id=excluded.franchise_id,slug=excluded.slug,code=excluded.code,name=excluded.name,"
        "collection=excluded.collection,image_count=excluded.image_count,cover_storage_key=excluded.cover_storage_key,"
        "gallery_manifest_key=excluded.gallery_manifest_key,gallery_version=excluded.gallery_version,published=1,"
        "search_text=excluded.search_text,source_key=excluded.source_key,source_sync_id=excluded.source_sync_id,"
        "updated_at=CURRENT_TIMESTAMP;"
    )


def render_sql(plan: SyncPlan) -> str:
    lines = [
        "PRAGMA foreign_keys = ON;",
        f"-- Tonecos catalog sync {plan.sync_id}",
        f"-- source sha256: {plan.source_sha256}",
        f"-- total={plan.total_models} changed={plan.changed_count} removed={plan.removed_count}",
    ]

    removed = list(plan.removed_ids)
    for group in chunked(removed):
        ids = ids_sql(group)
        lines.append(
            "UPDATE models SET published=0,"
            "slug='__archived__-' || id,code='__ARCHIVED__-' || id,updated_at=CURRENT_TIMESTAMP "
            f"WHERE id IN ({ids});"
        )

    moving = list(plan.moving_ids)
    for group in chunked(moving):
        ids = ids_sql(group)
        lines.append(
            "UPDATE models SET slug='__moving__-' || id,code='__MOVING__-' || id,updated_at=CURRENT_TIMESTAMP "
            f"WHERE id IN ({ids});"
        )

    lines.extend(category_statements(plan.changed))
    lines.extend(franchise_statements(plan.changed))
    lines.extend(model_statement(row, plan.sync_id) for row in plan.changed)

    if plan.has_remote_changes:
        lines.append(
            "INSERT INTO catalog_sync_runs(id,source_sha256,model_count,changed_count,removed_count,completed_at) VALUES("
            f"{sql_text(plan.sync_id)},{sql_text(plan.source_sha256)},{plan.total_models},{plan.changed_count},{plan.removed_count},CURRENT_TIMESTAMP) "
            "ON CONFLICT(id) DO UPDATE SET source_sha256=excluded.source_sha256,model_count=excluded.model_count,"
            "changed_count=excluded.changed_count,removed_count=excluded.removed_count,completed_at=CURRENT_TIMESTAMP;"
        )
    return "\n".join(lines) + "\n"


def find_npx() -> str:
    executable = shutil.which("npx") or shutil.which("npx.cmd")
    if not executable:
        raise RuntimeError("npx não encontrado no PATH")
    return executable


def execute_remote(sql_path: Path, config_path: Path, database: str) -> int:
    if not config_path.is_file():
        raise RuntimeError(
            f"config de deploy não encontrada: {config_path}. Execute `npm run cloudflare:config` primeiro."
        )
    command = [
        find_npx(), "wrangler", "d1", "execute", database,
        "--remote", "--config", str(config_path), "--file", str(sql_path), "--yes",
    ]
    completed = subprocess.run(command, check=False)
    return completed.returncode


def sync_catalog(
    models_path: Path,
    state_path: Path,
    sql_path: Path,
    config_path: Path | None,
    database: str,
    dry_run: bool,
    allow_empty: bool,
    allow_large_removal: bool,
) -> dict[str, Any]:
    if not models_path.is_file():
        raise FileNotFoundError(f"models.jsonl não encontrado: {models_path}")
    rows, source_sha = read_models(models_path)
    if not rows and not allow_empty:
        raise RuntimeError("models.jsonl vazio; use --allow-empty somente se a despublicação total for intencional")

    previous_state = load_state(state_path)
    plan = build_plan(rows, source_sha, previous_state)
    validate_removal_safety(plan, previous_state, allow_large_removal)

    sql_path.parent.mkdir(parents=True, exist_ok=True)
    sql_path.write_text(render_sql(plan), encoding="utf-8")
    summary = {
        "syncId": plan.sync_id,
        "sourceSha256": plan.source_sha256,
        "models": plan.total_models,
        "changed": plan.changed_count,
        "removed": plan.removed_count,
        "sql": str(sql_path),
        "dryRun": dry_run,
        "executed": False,
    }

    if dry_run:
        return summary
    if not plan.has_remote_changes:
        save_state(state_path, plan.next_state)
        summary["executed"] = False
        summary["noop"] = True
        return summary
    if config_path is None:
        raise RuntimeError("--config é obrigatório fora de --dry-run")

    return_code = execute_remote(sql_path, config_path, database)
    if return_code != 0:
        raise RuntimeError(f"Wrangler D1 falhou com código {return_code}; checkpoint local não foi atualizado")

    save_state(state_path, plan.next_state)
    summary["executed"] = True
    return summary


def main() -> int:
    parser = argparse.ArgumentParser(description="Sincroniza models.jsonl incrementalmente com Cloudflare D1.")
    parser.add_argument("models", type=Path, help="models.jsonl gerado por build_media_bundle.py")
    parser.add_argument("--state", type=Path, help="checkpoint; padrão: ao lado de models.jsonl")
    parser.add_argument("--sql", type=Path, help="SQL gerado; padrão: ao lado de models.jsonl")
    parser.add_argument("--config", type=Path, default=Path(".wrangler.deploy.jsonc"))
    parser.add_argument("--database", default="DB", help="binding/nome D1 usado pelo Wrangler")
    parser.add_argument("--dry-run", action="store_true")
    parser.add_argument("--allow-empty", action="store_true")
    parser.add_argument("--allow-large-removal", action="store_true")
    args = parser.parse_args()

    models_path = args.models.resolve()
    parent = models_path.parent
    state_path = args.state.resolve() if args.state else parent / "d1-publish-state.json"
    sql_path = args.sql.resolve() if args.sql else parent / "d1-sync.sql"
    config_path = args.config.resolve() if args.config else None

    try:
        summary = sync_catalog(
            models_path=models_path,
            state_path=state_path,
            sql_path=sql_path,
            config_path=config_path,
            database=args.database,
            dry_run=args.dry_run,
            allow_empty=args.allow_empty,
            allow_large_removal=args.allow_large_removal,
        )
    except (FileNotFoundError, RuntimeError, ValueError, UnicodeDecodeError) as exc:
        print(f"ERRO: {exc}", file=sys.stderr)
        return 2

    print(json.dumps(summary, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    sys.exit(main())
