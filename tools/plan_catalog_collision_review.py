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
    if not isinstance(report.get("exactSlugCollisions"), list):
        raise ValueError("missing slug collision groups")

    def review_groups(entries: list, kind: str) -> tuple[list[dict], set[str]]:
        groups: list[dict] = []
        seen: set[str] = set()
        for item in entries:
            if not isinstance(item, dict):
                raise ValueError("invalid collision group")
            key = item.get("key")
            if kind == "name":
                if not isinstance(key, list) or len(key) != 2:
                    raise ValueError("invalid name collision key")
                franchise, name = key
                if not isinstance(franchise, str) or not isinstance(name, str) or not name:
                    raise ValueError("invalid collision key")
            elif not isinstance(key, str) or not key:
                raise ValueError("invalid slug collision key")
            ids = item.get("modelIds")
            if (not isinstance(ids, list) or len(ids) < 2
                    or any(not isinstance(v, str) or not v.startswith("mdl_") or len(v) <= 4 for v in ids)):
                raise ValueError("invalid collision model ids")
            if len(ids) != len(set(ids)) or any(mid in seen for mid in ids):
                raise ValueError("overlapping collision groups")
            seen.update(ids)
            details = item.get("modelMetadata")
            if details is not None:
                if (not isinstance(details, list) or len(details) != len(ids)
                        or not all(isinstance(v, dict) for v in details)
                        or {v.get("modelId") for v in details} != set(ids)):
                    raise ValueError("collision model metadata mismatch")
            unavailable: list[str] = []
            if details is not None:
                for entry in details:
                    count = entry.get("imageCount")
                    if isinstance(count, bool) or not isinstance(count, int) or count < 0:
                        raise ValueError("invalid image count metadata")
                    if count == 0:
                        unavailable.append(entry["modelId"])
            group = {"modelsWithoutImages": sorted(unavailable),
                     "imageReviewReady": False,
                     "declaredImagesPresent": details is not None and not unavailable,
                     "visualEvidenceVerified": False,
                     "modelMetadata": details if details is not None else [],
                     "modelIds": sorted(ids), "modelCount": len(ids),
                     "pairwiseComparisons": len(ids) * (len(ids) - 1) // 2,
                     "reviewState": "requires_visual_and_provenance_review",
                     "sameSculptureProven": False, "mergeAuthorized": False}
            if kind == "name":
                group.update({"franchiseId": franchise, "normalizedName": name})
            else:
                group.update({"normalizedSlug": key, "kind": "public_slug_collision"})
            groups.append(group)
        return groups, seen

    groups, name_seen = review_groups(report["sameFranchiseNormalizedNameCollisions"], "name")
    slug_groups, slug_seen = review_groups(report["exactSlugCollisions"], "slug")
    if len(name_seen) > report["totalRecords"] or len(slug_seen) > report["totalRecords"]:
        raise ValueError("collision membership exceeds published total")
    groups.sort(key=lambda g: (-g["modelCount"], g["franchiseId"], g["normalizedName"]))
    slug_groups.sort(key=lambda g: (-g["modelCount"], g["normalizedSlug"]))
    return {"schemaVersion": 1, "policy": "review_only_no_automatic_identity_merge",
            "summary": {"publishedRecords": report["totalRecords"], "collisionGroups": len(groups),
                        "recordsFlagged": len(name_seen),
                        "recordsOutsideNameCollisionGroups": report["totalRecords"] - len(name_seen),
                        "potentialPairwiseComparisons": sum(g["pairwiseComparisons"] for g in groups),
                        "imageReviewReadyGroups": 0,
                        "groupsWithDeclaredImages": sum(g["declaredImagesPresent"] for g in groups),
                        "groupsWithVerifiedVisualEvidence": 0,
                        "groupsBlockedByMissingImages": sum(bool(g["modelsWithoutImages"]) for g in groups),
                        "slugConflictGroups": len(slug_groups),
                        "slugConflictRecords": len(slug_seen),
                        "slugPotentialPairwiseComparisons": sum(g["pairwiseComparisons"] for g in slug_groups),
                        "confirmedDuplicateSculptures": None, "mutations": 0},
            "groups": groups, "slugConflictGroups": slug_groups}

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
