#!/usr/bin/env python3
"""Read-only bridge from a dated Drive coverage export to canonical D1 source triage.

The Drive image SHA is historical local evidence, not proof of a live D1/R2
gallery, sculpt identity, image publication rights, or promotion readiness.
"""
from __future__ import annotations

import argparse
import csv
import hashlib
from datetime import date
import json
import re
import unicodedata
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


def compare_review_label(source: str, published: str) -> str:
    """Normalized text is a review hint, not an identity or similarity approval."""
    def norm(value: str) -> str:
        decomposed = unicodedata.normalize("NFKD", value.casefold())
        plain = "".join(c for c in decomposed if not unicodedata.combining(c))
        return re.sub(r"[^a-z0-9]+", " ", plain).strip()
    a, b = norm(source), norm(published)
    if a and a == b:
        return "exact"
    if a and b and (a in b or b in a):
        return "partial"
    return "different"


def reconcile(coverage: dict[str, Any], records: list[dict[str, str]],
              *, legacy_export_sha256: str, legacy_as_of: str,
              active_sha_index: dict[str, Any] | None = None,
              published_models: list[dict[str, Any]] | None = None) -> dict[str, Any]:
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
    metadata_by_id: dict[str, dict[str, Any]] | None = None
    if published_models is not None:
        if active_sha_index is None or not isinstance(published_models, list):
            raise DriveReconciliationError("published model metadata requires active SHA index")
        metadata_by_id = {}
        for m in published_models:
            if not isinstance(m, dict):
                raise DriveReconciliationError("invalid published model metadata")
            mid = m.get("id")
            if (not isinstance(mid, str) or not re.fullmatch(r"mdl_[0-9a-f]{20}", mid)
                    or mid in metadata_by_id
                    or any(not isinstance(m.get(key), str) or not m[key].strip()
                           for key in ("name", "franchise_name", "slug"))):
                raise DriveReconciliationError("inconsistent published model metadata")
            metadata_by_id[mid] = m
        if len(metadata_by_id) != coverage["summary"]["publishedModels"]:
            raise DriveReconciliationError("published model metadata count mismatch")
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
        if current is not None:
            gallery_count = current.get("sourceGalleryImageCount")
            metadata_available = current.get("sourceGalleryMetadataAvailable")
            if metadata_available is not None and not isinstance(metadata_available, bool):
                raise DriveReconciliationError("invalid source gallery metadata flag")
            if (gallery_count is not None and (
                    isinstance(gallery_count, bool)
                    or not isinstance(gallery_count, int) or gallery_count < 0
                    or metadata_available is False)):
                raise DriveReconciliationError("invalid source gallery image count")
        else:
            gallery_count = None
        link = ("id_and_slug" if current_by_id is not None and current_by_slug is current_by_id
                else "id_slug_changed" if current_by_id is not None
                else "slug_only" if current_by_slug is not None else "not_found")
        is_confirmed = bool(current and current["state"].startswith("confirmed_present_"))
        sha_model_candidates = sorted(by_sha.get(digest.lower(), set()))
        review_tier = "not_classified"
        target_metadata = None
        label_matches = None
        gallery_gate = "no_current_gallery_metadata"
        if gallery_count == 0:
            gallery_gate = "source_gallery_empty"
        elif gallery_count == 1:
            gallery_gate = "single_source_image_historical_sha_not_currently_rehashed"
        elif isinstance(gallery_count, int) and gallery_count > 1:
            gallery_gate = "multiple_source_images_require_full_gallery_identity_review"
        if metadata_by_id is not None and len(sha_model_candidates) == 1:
            mid = sha_model_candidates[0]
            target_metadata = metadata_by_id.get(mid)
            if target_metadata is None:
                raise DriveReconciliationError("SHA candidate is not in published model snapshot")
            person, franchise = row.get("personagem"), row.get("franquia")
            if not isinstance(person, str) or not isinstance(franchise, str):
                raise DriveReconciliationError("historical Drive labels are required for metadata review")
            name_match = compare_review_label(person, target_metadata["name"])
            franchise_match = compare_review_label(franchise, target_metadata["franchise_name"])
            label_matches = {"name": name_match, "franchise": franchise_match}
            review_tier = (
                "A_exact_name_and_franchise" if name_match == franchise_match == "exact"
                else "B_compatible_labels" if name_match in ("exact", "partial")
                and franchise_match in ("exact", "partial")
                else "C_metadata_difference_requires_visual_review"
            )
        output.append({
            "legacySlug": slug,
            "legacySourceProductId": int(raw_pid) if raw_pid else None,
            "currentSourceProductId": current["sourceProductId"] if current else None,
            "sourceLinkage": link,
            "legacyDriveStatus": state,
            "legacyImageSha256": digest.lower(),
            "currentD1IdentityState": current["state"] if current else None,
            "currentSourceGalleryImageCount": gallery_count,
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
            "shaReviewTier": review_tier,
            "sourceGalleryReviewGate": gallery_gate,
            "sourceGalleryFullyProven": False,
            "publishedModelName": target_metadata["name"] if target_metadata else None,
            "publishedFranchiseName": target_metadata["franchise_name"] if target_metadata else None,
            "publishedModelSlug": target_metadata["slug"] if target_metadata else None,
            "historicalCharacterLabel": row.get("personagem") if target_metadata else None,
            "historicalFranchiseLabel": row.get("franquia") if target_metadata else None,
            "shaLabelComparisons": label_matches,
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
        "currentCoverageSha256": _stable_content_sha256(coverage),
        "activeImageIndexSha256": (
            _stable_content_sha256(active_sha_index) if active_sha_index is not None else None
        ),
        "publishedModelsSnapshotSha256": (
            _stable_content_sha256(published_models) if published_models is not None else None
        ),
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
            "shaReviewTierCounts": dict(sorted(Counter(x["shaReviewTier"] for x in output).items())),
            "sourceGalleryReviewGateCounts": dict(sorted(Counter(x["sourceGalleryReviewGate"] for x in output).items())),
            "casesWithMultipleShaModelCandidates": sum(
                len(x["shaCandidateModelIds"]) > 1 for x in output
            ),
            "productionWrites": 0, "stagingWrites": 0, "imagesDownloaded": 0,
            "identitiesApproved": 0, "mediaPromotionsAuthorized": 0,
        },
        "workItems": output,
    }



REVIEW_DECISION_FIELDS = [
    "sourceProductId", "targetModelId", "sourceImageSha256", "sourceSnapshotSha256",
    "decision", "visualReviewed", "provenanceReviewed", "fullGalleryReviewed",
    "reviewer", "reviewedAt",
]


def _stable_content_sha256(value: Any) -> str:
    canonical = json.dumps(value, sort_keys=True, ensure_ascii=False, separators=(",", ":"))
    return hashlib.sha256(canonical.encode("utf-8")).hexdigest()


def _snapshot_digest(report: dict[str, Any]) -> str:
    snapshot = report.get("currentSourceSnapshot")
    required_hashes = (
        "currentCoverageSha256", "activeImageIndexSha256",
        "publishedModelsSnapshotSha256", "legacyCsvSha256",
    )
    if (not isinstance(snapshot, dict)
            or any(not isinstance(report.get(k), str)
                   or not re.fullmatch(r"[0-9a-f]{64}", report[k]) for k in required_hashes)):
        raise DriveReconciliationError(
            "bulk operator decisions require complete versioned coverage, active gallery SHA and published model snapshots"
        )
    return _stable_content_sha256({
        "sourceSnapshot": snapshot,
        "currentCoverageSha256": report["currentCoverageSha256"],
        "activeImageIndexSha256": report["activeImageIndexSha256"],
        "publishedModelsSnapshotSha256": report["publishedModelsSnapshotSha256"],
        "legacyCsvSha256": report["legacyCsvSha256"],
    })


def build_operator_review_template(report: dict[str, Any]) -> list[dict[str, str]]:
    """Only strong, unique, currently unreviewed mappings enter the bulk review.

    This produces empty approval fields. Evidence is not authorized by a
    coincident name, franchise or SHA until an operator independently attests
    visual identity, origin and full source gallery coverage.
    """
    snapshot_sha = _snapshot_digest(report)
    rows: list[dict[str, str]] = []
    for item in report.get("workItems", []):
        if not isinstance(item, dict):
            raise DriveReconciliationError("malformed Drive work item")
        mid = item.get("shaCandidateModelIds")
        if not (
            item.get("shaReviewTier") == "A_exact_name_and_franchise"
            and item.get("currentIdentityConfirmed") is False
            and item.get("sourceLinkage") == "id_and_slug"
            and str(item.get("currentD1IdentityState") or "").startswith("unreviewed_")
            and isinstance(mid, list) and len(mid) == 1
            and item.get("currentSourceProductId") == item.get("legacySourceProductId")
            and type(item.get("currentSourceProductId")) is int
            and item["currentSourceProductId"] > 0
            and item.get("identityApprovedByThisReport") is False
            and item.get("mediaPromotionAuthorized") is False
        ):
            continue
        sha = item.get("legacyImageSha256")
        if not isinstance(sha, str) or not re.fullmatch(r"[0-9a-f]{64}", sha):
            raise DriveReconciliationError("invalid approved-cohort image SHA")
        rows.append({
            "sourceProductId": str(item["currentSourceProductId"]),
            "targetModelId": mid[0],
            "sourceImageSha256": sha,
            "sourceSnapshotSha256": snapshot_sha,
            "decision": "", "visualReviewed": "", "provenanceReviewed": "",
            "fullGalleryReviewed": "", "reviewer": "", "reviewedAt": "",
        })
    ids = [int(row["sourceProductId"]) for row in rows]
    targets = [row["targetModelId"] for row in rows]
    if len(set(ids)) != len(ids) or len(set(targets)) != len(targets):
        raise DriveReconciliationError("ambiguous source or target within bulk review")
    return sorted(rows, key=lambda x: int(x["sourceProductId"]))


def render_operator_approved_evidence(
    report: dict[str, Any], decisions: list[dict[str, str]],
) -> list[dict[str, Any]]:
    """Convert only explicitly attested operator decisions into offline evidence.

    Caller may write this output to a local review directory, never directly
    to D1/R2. Existing identityReview parser remains the only canonical owner.
    """
    template = {row["sourceProductId"]: row for row in build_operator_review_template(report)}
    approved: list[dict[str, Any]] = []
    seen: set[str] = set()
    for row in decisions:
        if not isinstance(row, dict):
            raise DriveReconciliationError("invalid operator decision row")
        pid = row.get("sourceProductId")
        if not isinstance(pid, str) or pid not in template or pid in seen:
            raise DriveReconciliationError("unexpected or repeated operator source ID")
        seen.add(pid)
        original = template[pid]
        for key in ("targetModelId", "sourceImageSha256", "sourceSnapshotSha256"):
            if row.get(key) != original[key]:
                raise DriveReconciliationError("operator decision does not match current snapshot")
        decision = row.get("decision", "")
        if decision in ("", "hold", "reject"):
            continue
        if decision != "approve_map_existing":
            raise DriveReconciliationError("unsupported operator decision")
        if any(row.get(key) != "yes" for key in
               ("visualReviewed", "provenanceReviewed", "fullGalleryReviewed")):
            raise DriveReconciliationError("operator visual, origin and gallery review required")
        reviewer = row.get("reviewer")
        reviewed_at = row.get("reviewedAt")
        if (not isinstance(reviewer, str) or not 2 <= len(reviewer.strip()) <= 120
                or not isinstance(reviewed_at, str)):
            raise DriveReconciliationError("explicit reviewer and date required")
        try:
            if date.fromisoformat(reviewed_at).isoformat() != reviewed_at:
                raise ValueError("noncanonical date")
        except ValueError as exc:
            raise DriveReconciliationError("invalid operator review date") from exc
        approved.append({
            "version": 1, "sourceId": report["sourceId"],
            "sourceProductId": int(pid),
            "reviewedAt": reviewed_at,
            "sourceSnapshotSha256": original["sourceSnapshotSha256"],
            "historicalCsvSha256": report["legacyCsvSha256"],
            "sourceImageSha256": original["sourceImageSha256"],
            "identityReview": {
                "decision": "map_existing",
                "targetModelId": original["targetModelId"],
                "mapExistingApproved": True,
                "evidence": "exact active published image SHA plus explicitly reviewed full source gallery and sculpture identity",
                "operatorVisualReview": True,
                "operatorProvenanceReview": True,
                "operatorFullGalleryReview": True,
                "reviewer": reviewer.strip(),
            },
            "decision": {"mapExistingAuthorized": True, "identityResolved": True,
                         "mediaPromotionAuthorized": False,
                         "productionWrites": 0, "stagingWrites": 0},
        })
    return sorted(approved, key=lambda row: row["sourceProductId"])


def write_operator_review_template(report: dict[str, Any], path: Path) -> None:
    rows = build_operator_review_template(report)
    with path.open("w", encoding="utf-8", newline="") as file:
        writer = csv.DictWriter(file, fieldnames=REVIEW_DECISION_FIELDS)
        writer.writeheader()
        writer.writerows(rows)


def write_approved_evidence(
    report: dict[str, Any], decisions_csv: Path, output_dir: Path,
) -> int:
    with decisions_csv.open(encoding="utf-8-sig", newline="") as file:
        reader = csv.DictReader(file)
        if reader.fieldnames != REVIEW_DECISION_FIELDS:
            raise DriveReconciliationError("operator CSV must preserve exact template columns")
        decisions = list(reader)
    approved = render_operator_approved_evidence(report, decisions)
    if not approved:
        raise DriveReconciliationError("no explicitly reviewed identity decisions")
    paths = [
        output_dir / f"external-source-001-drive-map-existing-{row['sourceProductId']}-{row['reviewedAt']}.json"
        for row in approved
    ]
    if len(set(paths)) != len(paths) or any(path.exists() for path in paths):
        raise DriveReconciliationError("refusing to overwrite any existing identity evidence")
    output_dir.mkdir(parents=True, exist_ok=True)
    for path, row in zip(paths, approved):
        path.write_text(json.dumps(row, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    return len(approved)


def main() -> None:
    p = argparse.ArgumentParser(description="Bulk-review dated Drive evidence against canonical coverage")
    p.add_argument("coverage", type=Path)
    p.add_argument("legacy_drive_csv", type=Path)
    p.add_argument("--legacy-as-of", required=True)
    p.add_argument("--output", type=Path, required=True)
    p.add_argument("--active-sha-index", type=Path, default=None)
    p.add_argument("--published-models", type=Path, default=None)
    p.add_argument("--review-template-csv", type=Path, default=None)
    p.add_argument("--operator-decisions-csv", type=Path, default=None)
    p.add_argument("--approved-evidence-dir", type=Path, default=None)
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
    published_models = (json.loads(args.published_models.read_text(encoding="utf-8"))
                        if args.published_models else None)
    data = reconcile(coverage, records, legacy_export_sha256=hashlib.sha256(raw).hexdigest(),
                     legacy_as_of=args.legacy_as_of, active_sha_index=image_index,
                     published_models=published_models)
    if args.review_template_csv:
        write_operator_review_template(data, args.review_template_csv)
    if args.operator_decisions_csv:
        if not args.approved_evidence_dir:
            raise DriveReconciliationError("--approved-evidence-dir is mandatory with operator decisions")
        count = write_approved_evidence(data, args.operator_decisions_csv, args.approved_evidence_dir)
        print(json.dumps({"operatorApprovedEvidenceFiles": count, "productionWrites": 0}))
    elif args.approved_evidence_dir:
        raise DriveReconciliationError("--operator-decisions-csv required")
    args.output.write_text(json.dumps(data, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    print(json.dumps(data["summary"], ensure_ascii=False))


if __name__ == "__main__":
    main()
