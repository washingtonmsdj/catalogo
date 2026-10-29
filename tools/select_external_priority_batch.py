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


class PriorityBatchError(ValueError):
    pass


def normalized(value: Any) -> str:
    value = unicodedata.normalize("NFKD", str(value or "")).casefold()
    return "".join(char for char in value if char.isalnum())


def choose_batch(coverage: dict[str, Any], triage: dict[str, Any], limit: int = 3) -> dict[str, Any]:
    if isinstance(limit, bool) or not isinstance(limit, int) or not 1 <= limit <= 3:
        raise PriorityBatchError("review cohort must contain 1–3 products")
    cs = coverage.get("summary")
    ts = triage.get("summary")
    products = coverage.get("products")
    items = triage.get("workItems")
    if not isinstance(cs, dict) or not isinstance(ts, dict) or not isinstance(products, list) or not isinstance(items, list):
        raise PriorityBatchError("canonical coverage/triage missing")
    if (cs.get("sourceProducts") != len(products) or ts.get("sourceProducts") != len(products)
            or cs.get("confirmedPresent") != ts.get("confirmedPublishedIdentities")
            or ts.get("workItems") != len(items)
            or ts.get("workItems") + cs.get("confirmedPresent") != len(products)
            or cs.get("coverage100Proven") is not False
            or cs.get("productionWrites") != 0 or cs.get("stagingWrites") != 0
            or ts.get("productionWrites") != 0 or ts.get("stagingWrites") != 0
            or cs.get("candidateMetadataSemantics") != "review_only"):
        raise PriorityBatchError("inconsistent or unsafe canonical snapshot")
    by_id = {}
    for row in products:
        pid = row.get("sourceProductId") if isinstance(row, dict) else None
        if isinstance(pid, bool) or not isinstance(pid, int) or pid <= 0 or pid in by_id:
            raise PriorityBatchError("duplicate or invalid source product")
        by_id[pid] = row
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
