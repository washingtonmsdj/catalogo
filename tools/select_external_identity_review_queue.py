#!/usr/bin/env python3
"""Choose the next bounded identity-review batch from existing versioned evidence.

Selection is read-only; a review never authorizes publication. This replaces
hard-coded product IDs in the GitHub workflow with the evidence as SSOT.
"""
from __future__ import annotations

import argparse
import json
from pathlib import Path
from typing import Any


def evidence_rows(root: Path):
    for path in sorted(root.glob("external-source-001-*.json")):
        try:
            row = json.loads(path.read_text(encoding="utf-8"))
        except (OSError, ValueError) as exc:
            raise RuntimeError(f"invalid versioned evidence: {path.name}") from exc
        if isinstance(row, dict) and "sourceProductId" in row:
            product_id = row["sourceProductId"]
            if isinstance(product_id, bool) or not (
                isinstance(product_id, int) or (
                    isinstance(product_id, str) and product_id.isascii() and product_id.isdecimal()
                )
            ):
                raise RuntimeError(f"invalid sourceProductId in {path.name}")
            product_id = int(product_id)
            if product_id <= 0:
                raise RuntimeError(f"invalid sourceProductId in {path.name}")
            yield path, product_id, row


def approved_identity(row: dict[str, Any]) -> bool:
    identity = row.get("identityReview") or {}
    decision = row.get("decision") or {}
    if not isinstance(identity, dict) or not isinstance(decision, dict):
        raise RuntimeError("invalid identity decision structure")
    if decision.get("identityResolved") is not True:
        return False
    if identity.get("decision") == "map_existing":
        target = str(identity.get("targetModelId") or decision.get("canonicalModelId") or "").strip()
        return target.startswith("mdl_") and (
            identity.get("mapExistingApproved") is True
            or decision.get("mapExistingAuthorized") is True
            or decision.get("mapExistingApproved") is True
        )
    if identity.get("decision") == "new_model":
        return decision.get("newModelIdentityAuthorized") is True or decision.get("newModelAuthorized") is True
    return False


def select_next(root: Path, limit: int = 3) -> list[int]:
    if limit < 1 or limit > 3:
        raise ValueError("identity review must be bounded to 1–3 products")
    resolved: set[int] = set()
    deferred: set[int] = set()
    pending: dict[int, tuple[int, int]] = {}
    for path, pid, row in evidence_rows(root):
        if approved_identity(row):
            resolved.add(pid)
        if "-identity-preflight-" not in path.name:
            continue
        identity = row.get("identityReview") or {}
        staging = row.get("stagingEvidence") or {}
        decision = row.get("decision") or {}
        if not isinstance(identity, dict) or not isinstance(staging, dict) or not isinstance(decision, dict):
            raise RuntimeError(f"invalid preflight structure in {path.name}")
        if (
            identity.get("decision") != "unresolved"
            or decision.get("identityResolved") is not False
            or staging.get("completeStaging") is not True
        ):
            continue
        queue_gate = identity.get("reviewQueue")
        if queue_gate is not None:
            if not isinstance(queue_gate, dict):
                raise RuntimeError(f"invalid queue gate in {path.name}")
            if queue_gate.get("phase") == "historical_catalog_search_required":
                run_id = queue_gate.get("discoveryRunId")
                count_now = queue_gate.get("liveCandidateCount")
                if (
                    isinstance(run_id, bool)
                    or not isinstance(run_id, int)
                    or run_id <= 0
                    or isinstance(count_now, bool)
                    or not isinstance(count_now, int)
                    or count_now != 0
                ):
                    raise RuntimeError(f"invalid read-only discovery proof in {path.name}")
                deferred.add(pid)
        production = row.get("productionSearch") or {}
        count = production.get("exactOrTextualCandidateCount") if isinstance(production, dict) else None
        if count is None:
            snapshot = row.get("coverageSnapshot") or {}
            count = snapshot.get("exactNameCandidates") if isinstance(snapshot, dict) else None
        if isinstance(count, list):
            count = len(count)
        rank = 0 if isinstance(count, int) and not isinstance(count, bool) and count == 1 else 1
        pending[pid] = min(pending.get(pid, (2, pid)), (rank, pid))
    return [pid for pid, _ in sorted(
        ((pid, priority) for pid, priority in pending.items() if pid not in resolved and pid not in deferred),
        key=lambda item: (item[1], item[0]),
    )[:limit]]


def main() -> None:
    parser = argparse.ArgumentParser(description="Read-only SSOT identity-review queue")
    parser.add_argument("--evidence-root", type=Path, default=Path("docs/evidence"))
    parser.add_argument("--limit", type=int, default=3)
    args = parser.parse_args()
    print(",".join(str(product_id) for product_id in select_next(args.evidence_root, args.limit)))


if __name__ == "__main__":
    main()
