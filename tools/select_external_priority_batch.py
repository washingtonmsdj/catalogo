#!/usr/bin/env python3
"""Select a bounded image-review cohort from one verified catalog coverage snapshot.

A textual candidate is only a lead. Selection does not resolve identity or
license media. The same product and candidate must not be repeated in a cohort.
"""
from __future__ import annotations

import argparse
import json
import unicodedata
from pathlib import Path
from typing import Any

from plan_external_identity_triage import TriageError, build_triage


class PriorityBatchError(ValueError):
    pass


def normalized(value: Any) -> str:
    value = unicodedata.normalize("NFKD", str(value or "")).casefold()
    return "".join(char for char in value if char.isalnum())


def choose_batch(coverage: dict[str, Any], triage: dict[str, Any], limit: int = 3) -> dict[str, Any]:
    if isinstance(limit, bool) or not isinstance(limit, int) or not 1 <= limit <= 3:
        raise PriorityBatchError("review cohort must contain 1–3 products")
    # The triage is a deterministic projection of this exact coverage snapshot.
    # Checking only counts and state names permits accidental mixing of two
    # individually valid but different reports, including changed candidates.
    # Reuse the canonical planner rather than duplicating its policy here.
    try:
        expected = build_triage(coverage)
    except (TriageError, KeyError, TypeError, ValueError) as exc:
        raise PriorityBatchError("invalid canonical coverage snapshot") from exc
    if triage != expected:
        raise PriorityBatchError("triage differs from canonical coverage snapshot")

    products = coverage["products"]
    items = expected["workItems"]
    cs = coverage["summary"]
    by_id = {row["sourceProductId"]: row for row in products}
    selected = []
    used_candidates: set[str] = set()
    for row in items:
        if not isinstance(row, dict):
            raise PriorityBatchError("invalid triage item")
        pid = row.get("sourceProductId")
        source = by_id.get(pid)
        if not source or row.get("state") != source.get("state"):
            raise PriorityBatchError("triage differs from coverage")
        phase = row.get("phase")
        if phase not in {"visual_review", "alias_review"}:
            continue
        candidates = (source.get("exactNameCandidates") if phase == "visual_review"
                      else source.get("reviewAliasCandidates"))
        if not isinstance(candidates, list) or len(candidates) != 1:
            continue
        candidate = candidates[0]
        if not isinstance(candidate, dict):
            raise PriorityBatchError("invalid candidate metadata")
        model_id = candidate.get("modelId")
        franchise = normalized(candidate.get("franchiseName") or candidate.get("franchiseSlug"))
        categories = {normalized(x) for x in source.get("sourceCategories", [])}
        if not isinstance(model_id, str) or not model_id.startswith("mdl_"):
            raise PriorityBatchError("invalid candidate ID")
        if not franchise or franchise not in categories or model_id in used_candidates:
            continue  # conservative: no cross-franchise or duplicate-owner assumptions
        if row.get("identityApproved") is not False or row.get("mediaPromotionAuthorized") is not False:
            raise PriorityBatchError("review-only gate violated")
        selected.append({
            "sourceProductId": pid,
            "sourceName": source.get("sourceName"),
            "sourceCategories": source.get("sourceCategories"),
            "candidateModelId": model_id,
            "candidateFranchise": candidate.get("franchiseName"),
            "selectionBasis": phase,
            "identityApproved": False,
            "mediaPromotionAuthorized": False,
        })
        used_candidates.add(model_id)
        if len(selected) == limit:
            break
    return {
        "version": 1,
        "sourceId": coverage.get("sourceId"),
        "policy": "read_only_review_only_no_media_publication",
        "sourceProducts": len(products),
        "confirmedPresent": cs.get("confirmedPresent"),
        "selectedProductIds": [row["sourceProductId"] for row in selected],
        "selected": selected,
        "productionWrites": 0,
        "stagingWrites": 0,
    }


def main() -> None:
    parser = argparse.ArgumentParser(description="Choose a bounded read-only priority review cohort")
    parser.add_argument("coverage", type=Path)
    parser.add_argument("triage", type=Path)
    parser.add_argument("--limit", type=int, default=3)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    data = choose_batch(
        json.loads(args.coverage.read_text(encoding="utf-8")),
        json.loads(args.triage.read_text(encoding="utf-8")),
        args.limit,
    )
    args.output.write_text(json.dumps(data, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(json.dumps({"selectedProductIds": data["selectedProductIds"],
                      "selectionPolicy": data["policy"]}, ensure_ascii=False))


if __name__ == "__main__":
    main()
