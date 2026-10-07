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
