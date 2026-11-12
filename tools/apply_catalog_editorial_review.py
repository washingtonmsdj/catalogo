#!/usr/bin/env python3
"""Apply a bounded editorial review to the EXISTING production identity contract.

The contract is the canonical source for already published names and variants.
The resulting Git change is reviewed before the existing bundle/D1 publisher runs.
This tool never contacts the network, D1, R2, Drive or the Workers API.
"""
from __future__ import annotations

import argparse
import csv
import hashlib
import json
import os
import re
import tempfile
from pathlib import Path

from production_model_contract import (
    DEFAULT_PRODUCTION_MODEL_CONTRACT,
    load_production_model_contract,
)

MAX_ROWS = 12
HEADERS = (
    "ID canônico", "Slug", "Código", "Modelo", "Variante",
    "Categoria", "Franquia", "Imagens declaradas", "Chave da capa",
    "Estado da capa", "Novo nome", "Nova variante",
)
MODEL_ID = re.compile(r"^mdl_[a-f0-9]{20}$")
BAD_TEXT = re.compile(r"[\x00-\x1f\x7f]")
FORMULA = re.compile(r"^[=+@-]")


def valid_label(value: str, *, variant: bool = False) -> str:
    label = value.strip()
    limit = 160 if variant else 120
    if (not label or len(label) > limit or BAD_TEXT.search(value)
            or FORMULA.match(label) or "<" in label or ">" in label):
        raise ValueError("invalid_editorial_label")
    return label


def load_review_csv(path: Path) -> list[dict[str, str]]:
    with path.open("r", encoding="utf-8-sig", newline="") as handle:
        reader = csv.DictReader(handle, delimiter=";", strict=True)
        if tuple(reader.fieldnames or ()) != HEADERS:
            raise ValueError("editorial_review_headers_mismatch")
        rows = list(reader)
    if not 1 <= len(rows) <= MAX_ROWS:
        raise ValueError("editorial_review_page_size_invalid")
    ids: set[str] = set()
    for row in rows:
        if None in row or any(value is None for value in row.values()):
            raise ValueError("editorial_review_malformed_row")
        model_id = row["ID canônico"].strip()
        if not MODEL_ID.fullmatch(model_id) or model_id in ids:
            raise ValueError("editorial_review_duplicate_or_invalid_id")
        ids.add(model_id)
    return rows


def changes_from_review(rows: list[dict[str, str]], contract_by_id: dict[str, dict]) -> dict[str, dict[str, str]]:
    edits: dict[str, dict[str, str]] = {}
    for row in rows:
        # Other models on the exported page may have been published since the
        # historical contract snapshot. They are only context, not targets.
        if not row["Novo nome"].strip() and not row["Nova variante"].strip():
            continue
        model_id = row["ID canônico"].strip()
        current = contract_by_id.get(model_id)
        if current is None or not current["published"]:
            raise ValueError("editorial_review_model_not_in_published_contract")
        # Exact snapshot comparison stops stale/off-scope CSVs from changing the
        # wrong product, even if its public text or franchise has since changed.
        expected = {
            "Slug": current["slug"], "Código": current["code"],
            "Modelo": current["displayName"], "Variante": current["variantName"],
            "Categoria": current["categoryName"], "Franquia": current["franchiseName"],
        }
        if any(row[field] != value for field, value in expected.items()):
            raise ValueError("editorial_review_stale_snapshot")
        proposals: dict[str, str] = {}
        for column, field, variant in (
            ("Novo nome", "displayName", False),
            ("Nova variante", "variantName", True),
        ):
            if row[column].strip():
                proposed = valid_label(row[column], variant=variant)
                if proposed != current[field]:
                    proposals[field] = proposed
        if proposals:
            edits[model_id] = proposals

    # Do not create a duplicate public name+variant in the same catalog scope.
    # Existing collisions, if any, are not altered or globally rewritten.
    claimed = {
        (model["categorySlug"], model["franchiseSlug"], model["folderPathKey"],
         model["displayName"].casefold(), model["variantName"].casefold()): model_id
        for model_id, model in contract_by_id.items() if model["published"]
    }
    for model_id, proposal in edits.items():
        old = contract_by_id[model_id]
        name = proposal.get("displayName", old["displayName"])
        variant = proposal.get("variantName", old["variantName"])
        key = (old["categorySlug"], old["franchiseSlug"], old["folderPathKey"],
               name.casefold(), variant.casefold())
        if key in claimed and claimed[key] != model_id:
            raise ValueError("editorial_review_public_name_collision")
        claimed[key] = model_id
    return edits


def patch_contract_text(original: str, contract_by_id: dict[str, dict],
                        edits: dict[str, dict[str, str]]) -> str:
    updated = original
    for model_id in sorted(edits):
        before = contract_by_id[model_id]
        needle = '      "id": ' + json.dumps(model_id, ensure_ascii=False) + ','
        if updated.count(needle) != 1:
            raise ValueError("editorial_review_contract_format_unexpected")
        pos = updated.index(needle)
        start = updated.rfind("\n    {", 0, pos)
        end = updated.find("\n    }", pos)
        if start < 0 or end < 0:
            raise ValueError("editorial_review_contract_format_unexpected")
        start += 1
        end += len("\n    }")
        block = updated[start:end]
        try:
            parsed = json.loads(block)
        except json.JSONDecodeError as exc:
            raise ValueError("editorial_review_contract_format_unexpected") from exc
        if parsed.get("id") != model_id:
            raise ValueError("editorial_review_contract_format_unexpected")
        modified = block
        for field, new_value in edits[model_id].items():
            existing_line = '      "' + field + '": ' + json.dumps(before[field], ensure_ascii=False)
            replacement = '      "' + field + '": ' + json.dumps(new_value, ensure_ascii=False)
            if modified.count(existing_line) != 1:
                raise ValueError("editorial_review_contract_format_unexpected")
            modified = modified.replace(existing_line, replacement, 1)
        updated = updated[:start] + modified + updated[end:]
    parsed = json.loads(updated)
    if not isinstance(parsed.get("models"), list) or len(parsed["models"]) != len(contract_by_id):
        raise ValueError("editorial_review_contract_integrity_failed")
    return updated


def apply_review(review_path: Path, contract_path: Path, *, apply: bool = False) -> dict:
    rows = load_review_csv(review_path)
    existing = contract_path.read_bytes()
    original = existing.decode("utf-8")
    contract = load_production_model_contract(contract_path)
    edits = changes_from_review(rows, contract["byId"])
    if not edits:
        return {"reviewed": len(rows), "changed": 0, "applied": False, "modelIds": []}
    updated = patch_contract_text(original, contract["byId"], edits)
    if not apply:
        return {"reviewed": len(rows), "changed": len(edits), "applied": False,
                "modelIds": sorted(edits)}

    temp_name = None
    try:
        with tempfile.NamedTemporaryFile(
            mode="w", encoding="utf-8", newline="", dir=contract_path.parent,
            prefix=".catalog-contract-review-", suffix=".json", delete=False,
        ) as tmp:
            temp_name = tmp.name
            tmp.write(updated)
            tmp.flush()
            os.fsync(tmp.fileno())
        # Validate the full existing identity contract before any mutation.
        load_production_model_contract(Path(temp_name))
        if hashlib.sha256(contract_path.read_bytes()).digest() != hashlib.sha256(existing).digest():
            raise ValueError("editorial_review_contract_changed_concurrently")
        os.replace(temp_name, contract_path)
        temp_name = None
    finally:
        if temp_name and os.path.exists(temp_name):
            os.unlink(temp_name)
    return {"reviewed": len(rows), "changed": len(edits), "applied": True,
            "modelIds": sorted(edits)}


def main() -> int:
    parser = argparse.ArgumentParser(description="Review public names in the original canonical production contract")
    parser.add_argument("review", type=Path, help="CSV generated by TONART admin catalog")
    parser.add_argument("--contract", type=Path, default=DEFAULT_PRODUCTION_MODEL_CONTRACT)
    parser.add_argument("--apply", action="store_true", help="write after preconditions pass; default is dry-run")
    args = parser.parse_args()
    try:
        summary = apply_review(args.review, args.contract, apply=args.apply)
    except (ValueError, OSError, UnicodeError, json.JSONDecodeError) as exc:
        parser.exit(2, "BLOCKED: " + str(exc) + "\n")
    print(json.dumps(summary, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
