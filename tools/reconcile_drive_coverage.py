#!/usr/bin/env python3
"""Read-only bridge from a dated Drive coverage export to canonical D1 source triage.

The Drive image SHA is historical local evidence, not proof of a live D1/R2
gallery, sculpt identity, image publication rights, or promotion readiness.
"""
from __future__ import annotations

import argparse
import csv
import hashlib
import json
import re
from collections import Counter
from pathlib import Path
from typing import Any

from plan_external_identity_triage import build_triage

STATES = {
    "COBERTO_CATALOGO_SHA": "verify_current_d1_gallery_identity",
    "EM_NOVOS_SHA": "verify_current_gallery_then_rights_and_sculpture",
    "REVISAO_VISUAL_COBERTURA": "reuse_preserved_visual_decisions",
}
ORDER = {key: i for i, key in enumerate(STATES)}
SHA = re.compile(r"[0-9a-fA-F]{64}\Z")


class DriveReconciliationError(ValueError):
    pass


def reconcile(coverage: dict[str, Any], records: list[dict[str, str]],
              *, legacy_export_sha256: str, legacy_as_of: str,
              active_sha_index: dict[str, Any] | None = None) -> dict[str, Any]:
    canonical = build_triage(coverage)  # one SSOT for current identity states
    if not SHA.fullmatch(legacy_export_sha256):
        raise DriveReconciliationError("invalid source CSV digest")
    if not re.fullmatch(r"\d{4}-\d{2}-\d{2}", legacy_as_of):
        raise DriveReconciliationError("legacy source date required")
    by_id = {r["sourceProductId"]: r for r in coverage["products"]}
    by_slug = {r["sourceSlug"]: r for r in coverage["products"]}
    if len(by_slug) != len(by_id):
        raise DriveReconciliationError("ambiguous current source slugs")
    by_sha: dict[str, set[str]] = {}
    index_summary = None
    if active_sha_index is not None:
        index = active_sha_index
        summ = index.get("summary") if isinstance(index, dict) else None
        pairs = index.get("modelShaPairs") if isinstance(index, dict) else None
        if (not isinstance(summ, dict) or not isinstance(pairs, list)
                or index.get("version") != 1
                or index.get("scope") != "active_published_gallery_source_sha_read_only"
                or index.get("identityApproved") is not False
                or index.get("mediaPromotionAuthorized") is not False
                or index.get("missingShaProvesMissingSculpture") is not False
                or index.get("sourceShaProvesSculptureIdentity") is not False
                or index.get("productionWrites") != 0
                or index.get("stagingWrites") != 0
                or index.get("imageBinariesDownloaded") != 0
                or summ.get("publishedModels") != coverage["summary"]["publishedModels"]):
            raise DriveReconciliationError("unsafe or incompatible D1 SHA index")
        cursor = ("", "")
        indexed_models: set[str] = set()
        for pair in pairs:
            if not isinstance(pair, dict):
                raise DriveReconciliationError("invalid D1 SHA record")
            sha, mid = pair.get("sourceSha256"), pair.get("modelId")
            if (not isinstance(sha, str) or not re.fullmatch(r"[0-9a-f]{64}", sha)
                    or not isinstance(mid, str) or not re.fullmatch(r"mdl_[0-9a-f]{20}", mid)
                    or (sha, mid) <= cursor):
                raise DriveReconciliationError("unsorted or malformed D1 SHA records")
            cursor = sha, mid
            by_sha.setdefault(sha, set()).add(mid)
            indexed_models.add(mid)
        if (len(pairs) != summ.get("indexedImageRows")
                or len(indexed_models) != summ.get("indexedModels")
                or not isinstance(summ.get("modelsWithoutIndex"), int)
                or summ["modelsWithoutIndex"] != summ["publishedModels"] - len(indexed_models)
                or summ.get("allPublishedModelsIndexed") is not (len(indexed_models) == summ["publishedModels"])):
            raise DriveReconciliationError("inconsistent D1 SHA index summary")
        index_summary = summ
    seen: set[tuple[str, str]] = set()
    output: list[dict[str, Any]] = []
    for i, row in enumerate(records, 1):
        if not isinstance(row, dict):
            raise DriveReconciliationError(f"invalid Drive row {i}")
        state = row.get("status")
        if state not in STATES:
            raise DriveReconciliationError(f"unknown historical Drive status at row {i}")
        slug, raw_pid = row.get("slug"), row.get("post_id")
        digest = row.get("sha256")
        if not isinstance(slug, str) or not slug.strip() or slug != slug.strip():
            raise DriveReconciliationError(f"missing or malformed Drive slug at row {i}")
        if not isinstance(raw_pid, str) or (raw_pid and not (raw_pid.isascii() and raw_pid.isdecimal())):
            raise DriveReconciliationError(f"invalid historical source ID at row {i}")
        if not isinstance(digest, str) or not SHA.fullmatch(digest):
            raise DriveReconciliationError(f"invalid historical image SHA at row {i}")
        key = (raw_pid, slug)
        if key in seen:
            raise DriveReconciliationError(f"duplicate historical source at row {i}")
        seen.add(key)
        current_by_id = by_id.get(int(raw_pid)) if raw_pid else None
        current_by_slug = by_slug.get(slug)
        if current_by_id is not None and current_by_slug is not None and current_by_id is not current_by_slug:
            raise DriveReconciliationError(f"conflicting current source IDs for Drive row {i}")
        current = current_by_id or current_by_slug
        link = ("id_and_slug" if current_by_id is not None and current_by_slug is current_by_id
                else "id_slug_changed" if current_by_id is not None
                else "slug_only" if current_by_slug is not None else "not_found")
        is_confirmed = bool(current and current["state"].startswith("confirmed_present_"))
        sha_model_candidates = sorted(by_sha.get(digest.lower(), set()))
        output.append({
            "legacySlug": slug,
            "legacySourceProductId": int(raw_pid) if raw_pid else None,
            "currentSourceProductId": current["sourceProductId"] if current else None,
            "sourceLinkage": link,
            "legacyDriveStatus": state,
            "legacyImageSha256": digest.lower(),
            "currentD1IdentityState": current["state"] if current else None,
            "currentIdentityConfirmed": is_confirmed,
            "currentModelId": (
                current.get("approvedExistingTargetModelId") or current.get("expectedModelId")
                if is_confirmed else None
            ),
            "nextGate": ("already_confirmed_verify_gallery_if_needed" if is_confirmed
                         else STATES[state]),
            "imagePresentInCurrentD1Proven": False,
            "shaIndexedInActivePublishedGallery": bool(sha_model_candidates),
            "shaCandidateModelIds": sha_model_candidates,
            "shaEvidenceStatus": (
                "published_sha_candidate_requires_review" if sha_model_candidates
                else "not_in_current_index_does_not_prove_missing_sculpture"
                if index_summary else "index_not_supplied"
            ),
            "sameSculptureProvenByDriveSha": False,
            "identityApprovedByThisReport": False,
            "mediaPromotionAuthorized": False,
        })
    output.sort(key=lambda o: (
        o["currentIdentityConfirmed"],
        ORDER[o["legacyDriveStatus"]],
        o["sourceLinkage"] != "id_and_slug",
        o["currentSourceProductId"] or 0,
        o["legacySlug"],
    ))
    states = Counter(row["legacyDriveStatus"] for row in output)
    link_types = Counter(row["sourceLinkage"] for row in output)
    unconfirmed = Counter(
        row["legacyDriveStatus"] for row in output if not row["currentIdentityConfirmed"]
    )
    return {
        "version": 1,
        "sourceId": canonical["sourceId"],
        "policy": "historical_drive_evidence_read_only_no_auto_identity_or_media_promotion",
        "legacyAsOf": legacy_as_of,
        "legacyCsvSha256": legacy_export_sha256.lower(),
        "currentSourceSnapshot": canonical["sourceSnapshot"],
        "summary": {
            "currentSourceProducts": canonical["summary"]["sourceProducts"],
            "currentConfirmedPublishedIdentities": canonical["summary"]["confirmedPublishedIdentities"],
            "historicalDriveProducts": len(output),
            "historicalStatusCounts": dict(sorted(states.items())),
            "linkageCounts": dict(sorted(link_types.items())),
            "alreadyConfirmedWithinDriveCohort": sum(r["currentIdentityConfirmed"] for r in output),
            "historicalDriveProductsRequiringReconciliation": sum(
                not r["currentIdentityConfirmed"] for r in output
            ),
            "unconfirmedByDriveStatus": dict(sorted(unconfirmed.items())),
            "currentPublishedImageIndexSummary": index_summary,
            "historicalShaMatchedActiveGallery": sum(bool(x["shaCandidateModelIds"]) for x in output),
            "unconfirmedWithActiveGalleryShaCandidate": sum(
                bool(x["shaCandidateModelIds"]) and not x["currentIdentityConfirmed"]
                for x in output
            ),
            "casesWithMultipleShaModelCandidates": sum(
                len(x["shaCandidateModelIds"]) > 1 for x in output
            ),
            "productionWrites": 0, "stagingWrites": 0, "imagesDownloaded": 0,
            "identitiesApproved": 0, "mediaPromotionsAuthorized": 0,
        },
        "workItems": output,
    }


def main() -> None:
    p = argparse.ArgumentParser(description="Bulk-review dated Drive evidence against canonical coverage")
    p.add_argument("coverage", type=Path)
    p.add_argument("legacy_drive_csv", type=Path)
    p.add_argument("--legacy-as-of", required=True)
    p.add_argument("--output", type=Path, required=True)
    p.add_argument("--active-sha-index", type=Path, default=None)
    args = p.parse_args()
    raw = args.legacy_drive_csv.read_bytes()
    with args.legacy_drive_csv.open(encoding="utf-8-sig", newline="") as f:
        reader = csv.DictReader(f)
        needed = {"status", "post_id", "slug", "sha256"}
        if not reader.fieldnames or not needed.issubset(reader.fieldnames):
            raise DriveReconciliationError("Drive CSV missing required columns")
        records = list(reader)
    coverage = json.loads(args.coverage.read_text(encoding="utf-8-sig"))
    image_index = (json.loads(args.active_sha_index.read_text(encoding="utf-8"))
                   if args.active_sha_index else None)
    data = reconcile(coverage, records, legacy_export_sha256=hashlib.sha256(raw).hexdigest(),
                     legacy_as_of=args.legacy_as_of, active_sha_index=image_index)
    args.output.write_text(json.dumps(data, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    print(json.dumps(data["summary"], ensure_ascii=False))


if __name__ == "__main__":
    main()
