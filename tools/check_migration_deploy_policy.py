#!/usr/bin/env python3
"""Validate that migrate-before-worker remains backward compatible.

The production deploy applies pending D1 migrations before publishing the new
Worker. That ordering is safe only while every post-baseline migration is an
expand migration that the currently deployed Worker can tolerate.

This gate deliberately fails when a new required migration is unclassified or
contains an obviously destructive SQL operation. A future contract/cleanup
migration must therefore change the deployment strategy explicitly instead of
silently riding the migration-first path.
"""
from __future__ import annotations

import json
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
CONTRACT_PATH = ROOT / "config" / "catalog-schema-contract.json"
POLICY_PATH = ROOT / "config" / "migration-deploy-policy.json"
MIGRATIONS_DIR = ROOT / "migrations"

_UNSAFE_SQL = (
    ("drop-object", re.compile(r"\bDROP\s+(?:TABLE|VIEW|INDEX|TRIGGER)\b", re.IGNORECASE)),
    (
        "destructive-alter",
        re.compile(
            r"\bALTER\s+TABLE\s+(?:IF\s+EXISTS\s+)?[^\s;]+\s+(?:RENAME\b|DROP\s+COLUMN\b)",
            re.IGNORECASE,
        ),
    ),
    ("delete-rows", re.compile(r"\bDELETE\s+FROM\b", re.IGNORECASE)),
    (
        "replace-rows",
        re.compile(r"\b(?:INSERT\s+OR\s+REPLACE|REPLACE\s+INTO)\b", re.IGNORECASE),
    ),
    ("truncate", re.compile(r"\bTRUNCATE\b", re.IGNORECASE)),
    ("writable-schema", re.compile(r"\bPRAGMA\s+writable_schema\b", re.IGNORECASE)),
)


def _scrub_sql(sql: str) -> str:
    """Remove comments and string literals before scanning SQL keywords."""
    sql = re.sub(r"/\*.*?\*/", " ", sql, flags=re.DOTALL)
    sql = re.sub(r"--[^\n]*", " ", sql)
    return re.sub(r"'(?:''|[^'])*'", "''", sql)


def unsafe_operations(sql: str) -> list[str]:
    scrubbed = _scrub_sql(sql)
    return [name for name, pattern in _UNSAFE_SQL if pattern.search(scrubbed)]


def validate_repository(root: Path = ROOT) -> list[str]:
    contract_path = root / "config" / "catalog-schema-contract.json"
    policy_path = root / "config" / "migration-deploy-policy.json"
    migrations_dir = root / "migrations"

    contract = json.loads(contract_path.read_text(encoding="utf-8"))
    policy = json.loads(policy_path.read_text(encoding="utf-8"))

    errors: list[str] = []
    required = contract.get("requiredMigrations")
    latest = contract.get("latestMigration")
    strategy = policy.get("deploymentStrategy")
    baseline = policy.get("baselineThrough")
    classifications = policy.get("migrations")

    if not isinstance(required, list) or not required:
        return ["catalog schema contract must declare non-empty requiredMigrations"]
    if latest != required[-1]:
        errors.append("latestMigration must equal the last required migration")
    if strategy != "migrate-before-worker":
        errors.append("migration policy must explicitly use migrate-before-worker")
    if not isinstance(classifications, dict):
        return errors + ["migration policy must declare a migrations object"]
    if baseline not in required:
        errors.append("baselineThrough must be one of requiredMigrations")
        baseline_index = -1
    else:
        baseline_index = required.index(baseline)

    required_set = set(required)
    classified_set = set(classifications)
    missing = sorted(required_set - classified_set)
    extra = sorted(classified_set - required_set)
    if missing:
        errors.append("unclassified required migrations: " + ", ".join(missing))
    if extra:
        errors.append("policy contains non-required migrations: " + ", ".join(extra))

    for index, name in enumerate(required):
        migration_path = migrations_dir / name
        if not migration_path.is_file():
            errors.append(f"required migration is missing: {name}")
            continue

        classification = classifications.get(name)
        expected = "baseline" if index <= baseline_index else "expand"
        if classification != expected:
            errors.append(
                f"{name}: expected classification {expected!r}, got {classification!r}"
            )
            continue

        if classification == "expand":
            hazards = unsafe_operations(migration_path.read_text(encoding="utf-8"))
            if hazards:
                errors.append(f"{name}: expand migration contains {', '.join(hazards)}")

    return errors


def main() -> int:
    errors = validate_repository()
    if errors:
        for error in errors:
            print(f"ERROR: {error}")
        return 1
    print("Migration-first deployment policy: OK")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
