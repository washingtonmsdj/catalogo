#!/usr/bin/env python3
"""Build an auditable promotion manifest from a resolved gallery merge.

The output is authorization metadata only. It never copies, moves, deletes or
rewrites source files and intentionally does not invent physical destination
paths in the catalog master.
"""
from __future__ import annotations

import argparse
import csv
import hashlib
import json
import sys
from pathlib import Path
from typing import Any

ALLOWED_MODES = {"add_view", "replace_existing"}


def read_resolution(path: Path) -> dict[str, Any]:
    if not path.is_file():
        raise RuntimeError(f"resolução de galeria não encontrada: {path}")
    try:
        payload = json.loads(path.read_text(encoding="utf-8"))
    except json.JSONDecodeError as exc:
        raise RuntimeError(f"resolução de galeria inválida: {path}: {exc}") from exc
    if not isinstance(payload, dict) or payload.get("version") != 1:
        raise RuntimeError(f"contrato de resolução de galeria inválido: {path}")
    return payload


def validate_sha(value: Any, label: str) -> str:
    digest = str(value or "").strip().lower()
    if len(digest) != 64 or any(char not in "0123456789abcdef" for char in digest):
        raise RuntimeError(f"{label} inválido: {value!r}")
    return digest


def authorization_id(row: dict[str, str]) -> str:
    canonical = json.dumps(row, ensure_ascii=False, sort_keys=True, separators=(",", ":"))
    return "promo_" + hashlib.sha256(canonical.encode("utf-8")).hexdigest()[:20]


def build_promotion_rows(resolution: dict[str, Any]) -> tuple[list[dict[str, str]], dict[str, Any]]:
    if resolution.get("version") != 1 or resolution.get("ready") is not True:
        raise RuntimeError("resolução de galeria não está pronta para promoção")
    promotions = resolution.get("promotions")
    if not isinstance(promotions, list):
        raise RuntimeError("resolução de galeria sem lista de promoções")

    rows: list[dict[str, str]] = []
    seen_images: set[tuple[str, str, str]] = set()
    seen_authorizations: set[str] = set()

    for index, promotion in enumerate(promotions, 1):
        if not isinstance(promotion, dict):
            raise RuntimeError(f"promoção inválida na posição {index}")
        model = str(promotion.get("model") or "").strip()
        source_model = str(promotion.get("sourceModel") or model).strip()
        mode = str(promotion.get("mode") or "").strip()
        incoming = promotion.get("incoming")
        if not model or not source_model:
            raise RuntimeError(f"promoção sem identidade de modelo na posição {index}")
        if mode not in ALLOWED_MODES:
            raise RuntimeError(f"modo de promoção inválido na posição {index}: {mode!r}")
        if not isinstance(incoming, dict):
            raise RuntimeError(f"promoção sem imagem de entrada na posição {index}")

        source_path = str(incoming.get("path") or "").strip()
        source_sha = validate_sha(incoming.get("sha256"), "source_sha256")
        if not source_path:
            raise RuntimeError(f"promoção sem source_path na posição {index}")
        key = (source_path, source_sha, model)
        if key in seen_images:
            raise RuntimeError(f"imagem aparece em múltiplas promoções para o mesmo modelo: {source_path} -> {model}")
        seen_images.add(key)

        raw_replace = promotion.get("replaceSha256")
        replace_sha = ""
        if mode == "replace_existing":
            replace_sha = validate_sha(raw_replace, "replace_sha256")
            if replace_sha == source_sha:
                raise RuntimeError(f"replace_sha256 igual ao source_sha256: {source_path}")
        elif raw_replace not in (None, ""):
            raise RuntimeError(f"add_view não aceita replace_sha256: {source_path}")

        core = {
            "source_path": source_path,
            "source_sha256": source_sha,
            "target_model": model,
            "source_model": source_model,
            "mode": mode,
            "replace_sha256": replace_sha,
        }
        auth_id = authorization_id(core)
        if auth_id in seen_authorizations:
            raise RuntimeError(f"authorization_id duplicado: {auth_id}")
        seen_authorizations.add(auth_id)
        rows.append({"authorization_id": auth_id, **core})

    summary = {
        "version": 1,
        "ready": True,
        "promotions": len(rows),
        "addView": sum(row["mode"] == "add_view" for row in rows),
        "replaceExisting": sum(row["mode"] == "replace_existing" for row in rows),
        "sourceFilesModified": 0,
        "destructiveDeletes": 0,
    }
    return rows, summary


def write_csv(path: Path, rows: list[dict[str, str]]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    fields = [
        "authorization_id",
        "source_path",
        "source_sha256",
        "target_model",
        "source_model",
        "mode",
        "replace_sha256",
    ]
    with path.open("w", encoding="utf-8-sig", newline="") as handle:
        writer = csv.DictWriter(handle, fieldnames=fields)
        writer.writeheader()
        writer.writerows(rows)


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Gera manifesto CSV de promoções autorizadas sem alterar os arquivos de origem."
    )
    parser.add_argument("resolution", type=Path)
    parser.add_argument("--output", type=Path, required=True, help="CSV de autorizações de promoção")
    parser.add_argument("--summary", type=Path, help="JSON opcional com resumo do gate")
    args = parser.parse_args()

    try:
        rows, summary = build_promotion_rows(read_resolution(args.resolution))
        write_csv(args.output, rows)
        if args.summary:
            args.summary.parent.mkdir(parents=True, exist_ok=True)
            args.summary.write_text(json.dumps(summary, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    except RuntimeError as exc:
        print(f"ERRO: {exc}", file=sys.stderr)
        return 2

    print(json.dumps(summary, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    sys.exit(main())
