#!/usr/bin/env python3
"""Produce complete, reproducible, read-only identity triage from one coverage snapshot.

No product is considered a match without separate versioned identity evidence.
The output is a short-lived plan, not an authorization for a new model or gallery.
"""
from __future__ import annotations

import argparse
import json
from collections import Counter
from pathlib import Path
from typing import Any


CATEGORIES = {
    "confirmed_present_map_existing": ("confirmed", "none"),
    "confirmed_present_reviewed_new_model": ("confirmed", "none"),
    "reviewed_new_model_not_published": ("rights_gate", "verify_creator_rights_before_publication"),
    "reviewed_unresolved": ("identity_review", "reconcile_visual_or_historical_identity"),
    "unreviewed_single_exact_name_candidate": ("visual_review", "compare_single_candidate_sculpture"),
    "unreviewed_multiple_exact_name_candidates": ("variant_review", "compare_all_candidate_variants"),
    "unreviewed_no_exact_name_candidate": ("alias_search", "review_aliases_and_franchise_history"),
}
QUEUE_ORDER = {
    "visual_review": 0,
    "alias_review": 1,
    "variant_review": 2,
    "identity_review": 3,
    "alias_search": 4,
    "rights_gate": 5,
}


class TriageError(ValueError):
    pass


def validated_model_ids(candidates: Any, product_id: int, kind: str) -> list[str]:
    """Reject malformed or repeated review hints instead of silently exporting IDs."""
    if not isinstance(candidates, list):
        raise TriageError(f"invalid {kind} candidates: {product_id}")
    result: list[str] = []
    for item in candidates:
        model_id = item.get("modelId") if isinstance(item, dict) else None
        if (not isinstance(model_id, str) or not model_id.startswith("mdl_")
                or len(model_id) <= 4 or model_id != model_id.strip()):
            raise TriageError(f"invalid {kind} candidate model ID: {product_id}")
        result.append(model_id)
    if len(set(result)) != len(result):
        raise TriageError(f"duplicate {kind} candidate model IDs: {product_id}")
    return result


def build_triage(coverage: dict[str, Any]) -> dict[str, Any]:
    if not isinstance(coverage, dict) or not isinstance(coverage.get("summary"), dict):
        raise TriageError("coverage summary missing")
    summary = coverage["summary"]
    products = coverage.get("products")
    if not isinstance(products, list) or not products:
        raise TriageError("coverage products missing")
    if summary.get("sourceProducts") != len(products):
        raise TriageError("incomplete source snapshot")
    if (isinstance(summary.get("publishedModels"), bool)
            or not isinstance(summary.get("publishedModels"), int)
            or summary["publishedModels"] <= 0):
        raise TriageError("published catalog missing")
    if summary.get("productionWrites") != 0 or summary.get("stagingWrites") != 0:
        raise TriageError("unexpected production or staging writes")
    if summary.get("candidateMetadataSemantics") != "review_only":
        raise TriageError("candidate metadata must remain review-only")

    seen: set[int] = set()
    counted: Counter[str] = Counter()
    work: list[dict[str, Any]] = []
    confirmed = 0
    alias_sources_with_candidates = 0
    for row in products:
        if not isinstance(row, dict):
            raise TriageError("invalid product record")
        pid = row.get("sourceProductId")
        if isinstance(pid, bool) or not isinstance(pid, int) or pid <= 0 or pid in seen:
            raise TriageError("duplicate or invalid source product ID")
        seen.add(pid)
        state = row.get("state")
        if state not in CATEGORIES:
            raise TriageError(f"unknown source state: {state!r}")
        if row.get("candidateMetadataSemantics") != "review_only":
            raise TriageError(f"candidate metadata cannot authorize identity: {pid}")
        counted[state] += 1
        phase, next_gate = CATEGORIES[state]
        if phase == "confirmed":
            confirmed += 1
            continue
        candidates = row.get("exactNameCandidates", [])
        candidate_ids = validated_model_ids(candidates, pid, "exact")
        if state == "unreviewed_single_exact_name_candidate" and len(candidate_ids) != 1:
            raise TriageError(f"single-candidate state disagrees with metadata: {pid}")
        if state == "unreviewed_multiple_exact_name_candidates" and len(candidate_ids) <= 1:
            raise TriageError(f"multiple-candidate state disagrees with metadata: {pid}")
        if state == "unreviewed_no_exact_name_candidate" and candidate_ids:
            raise TriageError(f"no-candidate state disagrees with metadata: {pid}")
        alias_candidates = row.get("reviewAliasCandidates", [])
        alias_truncated = row.get("reviewAliasCandidatesTruncated", False)
        if not isinstance(alias_truncated, bool):
            raise TriageError(f"invalid review alias metadata: {pid}")
        alias_ids = validated_model_ids(alias_candidates, pid, "alias")
        if alias_ids and state != "unreviewed_no_exact_name_candidate":
            raise TriageError(f"alias candidates cannot override other states: {pid}")
        if alias_candidates:
            alias_sources_with_candidates += 1
        if state == "unreviewed_no_exact_name_candidate" and alias_candidates and not alias_truncated:
            phase, next_gate = "alias_review", "compare_title_category_alias_candidates"

        work.append({
            "sourceProductId": pid,
            "sourceName": str(row.get("sourceName") or ""),
            "sourceSlug": str(row.get("sourceSlug") or ""),
            "sourceCategories": row.get("sourceCategories") or [],
            "state": state,
            "phase": phase,
            "nextGate": next_gate,
            "exactNameCandidateCount": len(candidate_ids),
            "candidateModelIds": candidate_ids,
            "aliasCandidateModelIds": alias_ids,
            "aliasCandidatesTruncated": alias_truncated,
            "identityApproved": False,
            "mediaPromotionAuthorized": False,
            "productionWrites": 0,
            "stagingWrites": 0,
        })

    expected_states = summary.get("states")
    if not isinstance(expected_states, dict) or dict(counted) != {
        key: value for key, value in expected_states.items() if value != 0
    }:
        raise TriageError("state counts do not reconcile with the canonical coverage")
    if summary.get("confirmedPresent") != confirmed:
        raise TriageError("confirmed identity count mismatch")
    if ("unreviewedAliasSuggestions" in summary
            and summary["unreviewedAliasSuggestions"] != alias_sources_with_candidates):
        raise TriageError("review alias count mismatch")
    if summary.get("coverage100Proven") is not (confirmed == len(products)):
        raise TriageError("coverage100Proven inconsistent with report")

    work.sort(key=lambda row: (QUEUE_ORDER[row["phase"]], row["sourceProductId"]))
    phases = Counter(row["phase"] for row in work)
    return {
        "version": 1,
        "sourceId": str(coverage.get("sourceId") or ""),
        "sourceSnapshot": coverage.get("source") or {},
        "policy": "read_only_review_hints_not_identity_or_media_authorization",
        "summary": {
            "sourceProducts": len(products),
            "confirmedPublishedIdentities": confirmed,
            "workItems": len(work),
            "aliasReviewSources": alias_sources_with_candidates,
            "phaseCounts": {name: phases[name] for name in QUEUE_ORDER},
            "coverage100Proven": confirmed == len(products),
            "productionWrites": 0,
            "stagingWrites": 0,
        },
        "workItems": work,
    }


def main() -> None:
    p = argparse.ArgumentParser(description="Derive complete identity triage from verified coverage")
    p.add_argument("coverage", type=Path)
    p.add_argument("--output", type=Path, required=True)
    args = p.parse_args()
    result = build_triage(json.loads(args.coverage.read_text(encoding="utf-8")))
    args.output.write_text(json.dumps(result, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(json.dumps(result["summary"], ensure_ascii=False))


if __name__ == "__main__":
    main()
