#!/usr/bin/env python3
"""Shared fail-closed schema contract for catalog maintenance tools."""
from __future__ import annotations

import json
from pathlib import Path
from typing import Any


DEFAULT_CONTRACT_PATH = (
    Path(__file__).resolve().parents[1] / "config" / "catalog-schema-contract.json"
)


def load_schema_contract(path: Path = DEFAULT_CONTRACT_PATH) -> dict[str, Any]:
    if not path.is_file():
        raise RuntimeError(f"contrato de schema não encontrado: {path}")
    try:
        payload = json.loads(path.read_text(encoding="utf-8"))
    except json.JSONDecodeError as exc:
        raise RuntimeError(f"contrato de schema inválido: {path}: {exc}") from exc
    if not isinstance(payload, dict):
        raise RuntimeError("contrato de schema deve ser um objeto JSON")
    try:
        version = int(payload.get("version"))
    except (TypeError, ValueError) as exc:
        raise RuntimeError("versão do contrato de schema inválida") from exc
    required = payload.get("requiredMigrations")
    latest = str(payload.get("latestMigration") or "").strip()
    if version < 1 or not isinstance(required, list) or not required:
        raise RuntimeError("contrato de schema sem migrations obrigatórias")
    normalized = [str(item).strip() for item in required]
    if any(not item for item in normalized) or len(set(normalized)) != len(normalized):
        raise RuntimeError("contrato de schema contém migrations vazias/duplicadas")
    if not latest or latest != normalized[-1]:
        raise RuntimeError(
            f"latestMigration deve coincidir com a última migration obrigatória: {latest!r}"
        )
    return {
        **payload,
        "version": version,
        "requiredMigrations": normalized,
        "latestMigration": latest,
    }


def schema_migrations_statement(contract: dict[str, Any]) -> dict[str, Any]:
    required = list(contract["requiredMigrations"])
    placeholders = ",".join("?" for _ in required)
    return {
        "sql": f"SELECT name FROM d1_migrations WHERE name IN ({placeholders}) ORDER BY name",
        "params": required,
    }


def validate_applied_migrations(
    contract: dict[str, Any],
    applied_rows: list[dict[str, Any]],
) -> dict[str, Any]:
    applied = {
        str(row.get("name") or "").strip()
        for row in applied_rows
        if isinstance(row, dict) and str(row.get("name") or "").strip()
    }
    required = list(contract["requiredMigrations"])
    missing = [name for name in required if name not in applied]
    if missing:
        raise RuntimeError(
            "schema D1 ainda não está pronto: "
            f"{len(missing)} migration(ões) obrigatória(s) ausente(s); "
            f"primeira={missing[0]}, última exigida={contract['latestMigration']}"
        )
    return {
        "ready": True,
        "contractVersion": int(contract["version"]),
        "latestMigration": str(contract["latestMigration"]),
        "requiredMigrations": len(required),
        "appliedRequiredMigrations": len(required),
    }



def _required_structure_keys(contract: dict[str, Any]) -> list[str]:
    required_objects = contract.get("requiredObjects")
    if not isinstance(required_objects, dict):
        raise RuntimeError("contrato de schema sem requiredObjects")
    keys: list[str] = []
    for plural, sqlite_type in (
        ("tables", "table"),
        ("indexes", "index"),
        ("triggers", "trigger"),
    ):
        names = required_objects.get(plural)
        if not isinstance(names, list):
            raise RuntimeError(f"requiredObjects.{plural} inválido")
        for raw_name in names:
            name = str(raw_name).strip()
            if not name:
                raise RuntimeError(f"requiredObjects.{plural} contém nome vazio")
            keys.append(f"{sqlite_type}:{name}")
    columns = required_objects.get("columns")
    if not isinstance(columns, dict):
        raise RuntimeError("requiredObjects.columns inválido")
    for table, names in columns.items():
        table_name = str(table).strip()
        if not table_name.replace("_", "").isalnum() or not table_name[0].isalpha():
            raise RuntimeError(f"nome de tabela inválido no contrato: {table_name!r}")
        if not isinstance(names, list):
            raise RuntimeError(f"colunas inválidas no contrato: {table_name}")
        for raw_name in names:
            name = str(raw_name).strip()
            if not name:
                raise RuntimeError(f"coluna vazia no contrato: {table_name}")
            keys.append(f"column:{table_name}.{name}")
    if len(set(keys)) != len(keys):
        raise RuntimeError("requiredObjects contém estruturas duplicadas")
    return keys


def schema_structure_statement(contract: dict[str, Any]) -> dict[str, Any]:
    required_objects = contract["requiredObjects"]
    selects: list[str] = []
    params: list[str] = []

    for plural, sqlite_type in (
        ("tables", "table"),
        ("indexes", "index"),
        ("triggers", "trigger"),
    ):
        names = [str(item).strip() for item in required_objects[plural]]
        if not names:
            continue
        placeholders = ",".join("?" for _ in names)
        selects.append(
            "SELECT ? || ':' || name AS structure_key "
            f"FROM sqlite_schema WHERE type=? AND name IN ({placeholders})"
        )
        params.extend([sqlite_type, sqlite_type, *names])

    for table, raw_names in required_objects["columns"].items():
        table_name = str(table).strip()
        if not table_name.replace("_", "").isalnum() or not table_name[0].isalpha():
            raise RuntimeError(f"nome de tabela inválido no contrato: {table_name!r}")
        names = [str(item).strip() for item in raw_names]
        if not names:
            continue
        placeholders = ",".join("?" for _ in names)
        selects.append(
            "SELECT ? || name AS structure_key "
            f"FROM pragma_table_info('{table_name}') WHERE name IN ({placeholders})"
        )
        params.extend([f"column:{table_name}.", *names])

    if not selects:
        raise RuntimeError("contrato de schema não possui estruturas obrigatórias")
    return {
        "sql": " UNION ALL ".join(selects),
        "params": params,
    }


def validate_schema_structures(
    contract: dict[str, Any],
    rows: list[dict[str, Any]],
) -> dict[str, Any]:
    required = _required_structure_keys(contract)
    found = {
        str(row.get("structure_key") or "").strip()
        for row in rows
        if isinstance(row, dict) and str(row.get("structure_key") or "").strip()
    }
    missing = [key for key in required if key not in found]
    if missing:
        raise RuntimeError(
            "estrutura D1 diverge do contrato: "
            f"{len(missing)} item(ns) ausente(s); primeiro={missing[0]}"
        )
    return {
        "requiredStructures": len(required),
        "verifiedStructures": len(required),
    }
