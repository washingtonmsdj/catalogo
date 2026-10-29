#!/usr/bin/env python3
"""Rank read-only model name collisions for manual sculpture review."""
from __future__ import annotations
import argparse
import json
from pathlib import Path

def plan(report: dict) -> dict:
    if not isinstance(report, dict) or report.get("schemaVersion") != 1:
        raise ValueError("unsupported collision report")
    if report.get("classification") != "review_only" or report.get("mutationAuthorized") is not False:
        raise ValueError("unsafe collision report")
    if report.get("sculptureUniquenessProven") is not False:
        raise ValueError("uniqueness cannot be inferred")
    if report.get("totalRecords") != report.get("uniqueRecordIds") or not isinstance(report.get("totalRecords"), int):
        raise ValueError("record identity mismatch")
    if not isinstance(report.get("sameFranchiseNormalizedNameCollisions"), list):
        raise ValueError("missing collision groups")
    groups = []
    seen = set()
    for item in report["sameFranchiseNormalizedNameCollisions"]:
        if not isinstance(item, dict) or not isinstance(item.get("key"), list) or len(item["key"]) != 2:
            raise ValueError("invalid collision group")
        ids = item.get("modelIds")
        if not isinstance(ids, list) or len(ids) < 2 or any(not isinstance(v, str) or not v.startswith("mdl_") for v in ids):
            raise ValueError("invalid collision model ids")
        if len(ids) != len(set(ids)) or any(mid in seen for mid in ids):
            raise ValueError("overlapping collision groups")
        seen.update(ids)
        franchise, name = item["key"]
        if not isinstance(franchise, str) or not isinstance(name, str) or not name:
            raise ValueError("invalid collision key")
        details = item.get("modelMetadata")
        if details is not None:
            if (not isinstance(details, list) or len(details) != len(ids)
                    or {v.get("modelId") for v in details if isinstance(v, dict)} != set(ids)):
                raise ValueError("collision model metadata mismatch")
        unavailable = []
        if details is not None:
            for entry in details:
                count = entry.get("imageCount")
                if isinstance(count, bool) or not isinstance(count, int) or count < 0:
                    raise ValueError("invalid image count metadata")
                if count == 0:
                    unavailable.append(entry["modelId"])
        groups.append({"franchiseId": franchise, "normalizedName": name,
                       "modelsWithoutImages": sorted(unavailable),
                       "imageReviewReady": False,
                       "declaredImagesPresent": details is not None and not unavailable,
                       "visualEvidenceVerified": False,
                       "modelMetadata": details if details is not None else [],
                       "modelIds": sorted(ids), "modelCount": len(ids),
                       "pairwiseComparisons": len(ids) * (len(ids) - 1) // 2,
                       "reviewState": "requires_visual_and_provenance_review",
                       "sameSculptureProven": False, "mergeAuthorized": False})
    if len(seen) > report["totalRecords"]:
        raise ValueError("collision membership exceeds published total")
    groups.sort(key=lambda g: (-g["modelCount"], g["franchiseId"], g["normalizedName"]))
    return {"schemaVersion": 1, "policy": "review_only_no_automatic_identity_merge",
            "summary": {"publishedRecords": report["totalRecords"], "collisionGroups": len(groups),
                        "recordsFlagged": len(seen),
                        "recordsOutsideNameCollisionGroups": report["totalRecords"] - len(seen),
                        "potentialPairwiseComparisons": sum(g["pairwiseComparisons"] for g in groups),
                        "imageReviewReadyGroups": 0,
                        "groupsWithDeclaredImages": sum(g["declaredImagesPresent"] for g in groups),
                        "groupsWithVerifiedVisualEvidence": 0,
                        "groupsBlockedByMissingImages": sum(bool(g["modelsWithoutImages"]) for g in groups),
                        "confirmedDuplicateSculptures": None, "mutations": 0},
            "groups": groups}

def main():
    p = argparse.ArgumentParser()
    p.add_argument("collision_report", type=Path)
    p.add_argument("--output", type=Path, required=True)
    args = p.parse_args()
    result = plan(json.loads(args.collision_report.read_text(encoding="utf-8")))
    args.output.write_text(json.dumps(result, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(json.dumps(result["summary"], ensure_ascii=False))

if __name__ == "__main__":
    main()
