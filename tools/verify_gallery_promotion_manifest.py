#!/usr/bin/env python3
"""Verify an authorized gallery promotion manifest before any local copy step."""
from __future__ import annotations

import argparse
import csv
import hashlib
import json
import re
import sys
from pathlib import Path
from typing import Any

from build_gallery_promotion_manifest import build_promotion_rows, read_resolution
from plan_gallery_merge import image_sha, model_identity, public_candidate, read_jsonl

FIELDS = [
    "authorization_id",
    "resolution_sha256",
    "source_path",
    "source_sha256",
    "target_model",
    "source_model",
    "mode",
    "replace_sha256",
]


def read_promotion_csv(path: Path) -> list[dict[str, str]]:
    if not path.is_file():
        raise RuntimeError(f"manifesto de promoções não encontrado: {path}")
    with path.open("r", encoding="utf-8-sig", newline="") as handle:
        reader = csv.DictReader(handle)
        if reader.fieldnames != FIELDS:
            raise RuntimeError(
                f"colunas do manifesto de promoções divergentes: esperado {FIELDS}, obtido {reader.fieldnames}"
            )
        rows = []
        for line_no, row in enumerate(reader, 2):
            normalized = {field: str(row.get(field) or "").strip() for field in FIELDS}
            if not normalized["authorization_id"]:
                raise RuntimeError(f"authorization_id vazio na linha {line_no}")
            rows.append(normalized)
    return rows


def safe_source_path(root: Path, value: str) -> Path:
    normalized = value.replace("\\", "/").strip()
    if (
        not normalized
        or normalized.startswith("/")
        or re.match(r"^[A-Za-z]:", normalized)
        or any(part in {"", ".", ".."} for part in normalized.split("/"))
    ):
        raise RuntimeError(f"source_path inseguro: {value!r}")
    return root.joinpath(*normalized.split("/"))


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def verify_manifest(
    resolution: dict[str, Any],
    actual_rows: list[dict[str, str]],
    *,
    source_root: Path | None = None,
    existing_rows: list[dict[str, Any]] | None = None,
) -> dict[str, Any]:
    expected_rows, expected_summary = build_promotion_rows(resolution)
    expected_by_id = {row["authorization_id"]: row for row in expected_rows}
    actual_by_id: dict[str, dict[str, str]] = {}

    for row in actual_rows:
        auth_id = row["authorization_id"]
        if auth_id in actual_by_id:
            raise RuntimeError(f"authorization_id duplicado no CSV: {auth_id}")
        actual_by_id[auth_id] = row

    missing = sorted(set(expected_by_id).difference(actual_by_id))
    extra = sorted(set(actual_by_id).difference(expected_by_id))
    if missing or extra:
        raise RuntimeError(
            f"autorizações divergentes da resolução: ausentes={missing[:5]} extras={extra[:5]}"
        )

    for auth_id, expected in expected_by_id.items():
        actual = actual_by_id[auth_id]
        if actual != expected:
            differing = [field for field in FIELDS if actual.get(field) != expected.get(field)]
            raise RuntimeError(
                f"autorização alterada em relação à resolução: {auth_id}; campos={differing}"
            )

    verified_replace_targets = 0
    if existing_rows is not None:
        current = {
            (model_identity(row), image_sha(row))
            for row in existing_rows
            if public_candidate(row)
        }
        for row in actual_rows:
            if row["mode"] != "replace_existing":
                continue
            target = (row["target_model"], row["replace_sha256"])
            if target not in current:
                raise RuntimeError(
                    f"vista a superseder não existe mais no catálogo atual: "
                    f"{row['target_model']} / {row['replace_sha256']}"
                )
            verified_replace_targets += 1

    verified_sources = 0
    verified_cache: set[tuple[str, str]] = set()
    if source_root is not None:
        root = source_root.resolve()
        if not root.is_dir():
            raise RuntimeError(f"raiz da fonte não encontrada: {root}")
        for row in actual_rows:
            cache_key = (row["source_path"], row["source_sha256"])
            if cache_key in verified_cache:
                continue
            source = safe_source_path(root, row["source_path"])
            if not source.is_file():
                raise RuntimeError(f"arquivo autorizado ausente: {source}")
            actual_sha = sha256_file(source)
            if actual_sha != row["source_sha256"]:
                raise RuntimeError(
                    f"SHA da origem divergente: {row['source_path']} "
                    f"(esperado {row['source_sha256']}, obtido {actual_sha})"
                )
            verified_cache.add(cache_key)
            verified_sources += 1

    return {
        "version": 1,
        "ready": True,
        "resolutionSha256": expected_summary["resolutionSha256"],
        "authorizations": len(actual_rows),
        "verifiedSources": verified_sources,
        "sourceVerificationRequested": source_root is not None,
        "verifiedReplaceTargets": verified_replace_targets,
        "existingManifestVerificationRequested": existing_rows is not None,
        "destructiveDeletes": 0,
    }


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Valida manifesto de promoções contra a resolução e, opcionalmente, contra os arquivos da fonte."
    )
    parser.add_argument("resolution", type=Path)
    parser.add_argument("manifest", type=Path)
    parser.add_argument("--source-root", type=Path, help="raiz real da fonte para recalcular SHA-256")
    parser.add_argument(
        "--existing-manifest",
        type=Path,
        help="manifest.jsonl atual do catálogo para revalidar alvos replace_existing",
    )
    args = parser.parse_args()

    try:
        result = verify_manifest(
            read_resolution(args.resolution),
            read_promotion_csv(args.manifest),
            source_root=args.source_root,
            existing_rows=read_jsonl(args.existing_manifest) if args.existing_manifest else None,
        )
    except RuntimeError as exc:
        print(f"ERRO: {exc}", file=sys.stderr)
        return 2

    print(json.dumps(result, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    sys.exit(main())
