#!/usr/bin/env python3
from __future__ import annotations

import argparse
import csv
import json
import re
import sys
from collections import defaultdict
from pathlib import Path
from typing import Any

from model_identity import candidate_confidence, slug_view_descriptor


def load_models(path: Path) -> list[dict[str, Any]]:
    rows: list[dict[str, Any]] = []
    with path.open("r", encoding="utf-8") as handle:
        for line_no, line in enumerate(handle, 1):
            if not line.strip():
                continue
            try:
                row = json.loads(line)
            except json.JSONDecodeError as exc:
                raise RuntimeError(f"JSON inválido em {path}:{line_no}: {exc}") from exc
            if not isinstance(row, dict):
                raise RuntimeError(f"registro inválido em {path}:{line_no}")
            rows.append(row)
    return rows


def split_view_candidates(rows: list[dict[str, Any]]) -> list[dict[str, Any]]:
    groups: dict[tuple[str, str, str, str, str], list[dict[str, Any]]] = defaultdict(list)
    for row in rows:
        try:
            image_count = int(row.get("imageCount") or 0)
        except (TypeError, ValueError):
            image_count = 0
        if image_count != 1:
            continue
        slug = str(row.get("slug") or "").strip()
        match = slug_view_descriptor(slug)
        if not match:
            continue
        family, descriptor = match
        key = (
            str(row.get("categorySlug") or "").strip(),
            str(row.get("franchiseSlug") or "").strip(),
            str(row.get("folderPathKey") or "").strip(),
            str(row.get("displayName") or "").strip().casefold(),
            family,
        )
        groups[key].append({
            "id": str(row.get("id") or ""),
            "slug": slug,
            "code": str(row.get("code") or ""),
            "descriptor": descriptor.stem_suffix,
            "priority": descriptor.priority,
            "kind": descriptor.kind,
        })

    candidates: list[dict[str, Any]] = []
    for key, members in groups.items():
        if len(members) < 2:
            continue
        ordered = sorted(members, key=lambda item: (item["priority"], item["slug"]))
        descriptors = []
        for item in ordered:
            match = slug_view_descriptor(item["slug"])
            if match:
                descriptors.append(match[1])
        category, franchise, folder, display_name, family = key
        candidates.append({
            "categorySlug": category,
            "franchiseSlug": franchise,
            "folderPathKey": folder,
            "displayNameKey": display_name,
            "family": family,
            "confidence": candidate_confidence(descriptors),
            "canonicalId": ordered[0]["id"],
            "canonicalSlug": ordered[0]["slug"],
            "members": ordered,
        })

    return sorted(
        candidates,
        key=lambda item: (
            0 if item["confidence"] == "high" else 1,
            item["categorySlug"],
            item["franchiseSlug"],
            item["folderPathKey"],
            item["family"],
        ),
    )


def sibling_suffix_candidates(rows: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Find likely file/export suffix siblings without merging anything.

    Explicit copy markers are strong review signals. Pure numeric suffixes are
    review-only because numbered models are common legitimate products.
    A candidate exists only when the exact base slug is also present in the
    same category/franchise/folder/display-name scope.
    """
    scopes: dict[tuple[str, str, str, str], dict[str, dict[str, Any]]] = defaultdict(dict)
    for row in rows:
        slug = str(row.get("slug") or "").strip()
        if not slug:
            continue
        key = (
            str(row.get("categorySlug") or "").strip(),
            str(row.get("franchiseSlug") or "").strip(),
            str(row.get("folderPathKey") or "").strip(),
            str(row.get("displayName") or "").strip().casefold(),
        )
        scopes[key][slug] = row

    explicit_pattern = re.compile(r"-(?:copy|copia|duplicate|duplicado)(?:-\d+)?$", re.IGNORECASE)
    numeric_pattern = re.compile(r"-\d{1,6}$")
    grouped: dict[tuple[tuple[str, str, str, str], str, str], dict[str, Any]] = {}

    for scope, by_slug in scopes.items():
        for slug, row in by_slug.items():
            kind = ""
            match = explicit_pattern.search(slug)
            if match:
                kind = "explicit-copy-marker"
            else:
                match = numeric_pattern.search(slug)
                if match:
                    kind = "numbered-review"
            if not match:
                continue
            base_slug = slug[:match.start()]
            base = by_slug.get(base_slug)
            if not base:
                continue
            group_key = (scope, base_slug, kind)
            item = grouped.setdefault(group_key, {
                "kind": kind,
                "categorySlug": scope[0],
                "franchiseSlug": scope[1],
                "folderPathKey": scope[2],
                "displayNameKey": scope[3],
                "baseId": str(base.get("id") or ""),
                "baseSlug": base_slug,
                "siblings": [],
            })
            item["siblings"].append({
                "id": str(row.get("id") or ""),
                "slug": slug,
                "code": str(row.get("code") or ""),
            })

    results = list(grouped.values())
    for item in results:
        item["siblings"].sort(key=lambda sibling: sibling["slug"])
    return sorted(
        results,
        key=lambda item: (
            0 if item["kind"] == "explicit-copy-marker" else 1,
            item["categorySlug"],
            item["franchiseSlug"],
            item["folderPathKey"],
            item["baseSlug"],
        ),
    )


def cross_model_sha_candidates(rows: list[dict[str, Any]], r2_root: Path) -> list[dict[str, Any]]:
    by_sha: dict[str, list[dict[str, str]]] = defaultdict(list)
    for row in rows:
        model_id = str(row.get("id") or "")
        manifest_key = str(row.get("galleryManifestKey") or "")
        if not model_id or not manifest_key:
            continue
        manifest_path = r2_root / manifest_key
        if not manifest_path.is_file():
            continue
        try:
            manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError):
            continue
        images = manifest.get("images")
        if not isinstance(images, list):
            continue
        for image in images:
            if not isinstance(image, dict):
                continue
            sha = str(image.get("sourceSha256") or "").strip().lower()
            if len(sha) != 64:
                continue
            by_sha[sha].append({
                "modelId": model_id,
                "slug": str(row.get("slug") or ""),
                "imageId": str(image.get("id") or ""),
            })

    results = []
    for sha, refs in by_sha.items():
        model_ids = sorted({ref["modelId"] for ref in refs})
        if len(model_ids) < 2:
            continue
        results.append({
            "sha256": sha,
            "modelCount": len(model_ids),
            "models": refs,
        })
    return sorted(results, key=lambda item: (-item["modelCount"], item["sha256"]))


def write_report(
    output: Path,
    view_candidates: list[dict[str, Any]],
    sha_candidates: list[dict[str, Any]],
    sibling_candidates: list[dict[str, Any]] | None = None,
) -> dict[str, Any]:
    output.mkdir(parents=True, exist_ok=True)
    sibling_candidates = list(sibling_candidates or [])
    explicit_copy = [item for item in sibling_candidates if item["kind"] == "explicit-copy-marker"]
    numbered_review = [item for item in sibling_candidates if item["kind"] == "numbered-review"]
    high = [item for item in view_candidates if item["confidence"] == "high"]
    review = [item for item in view_candidates if item["confidence"] != "high"]
    summary = {
        "version": 2,
        "splitViewCandidateGroups": len(view_candidates),
        "highConfidenceGroups": len(high),
        "reviewGroups": len(review),
        "splitViewRows": sum(len(item["members"]) for item in view_candidates),
        "potentialExtraCards": sum(len(item["members"]) - 1 for item in view_candidates),
        "crossModelExactShaGroups": len(sha_candidates),
        "explicitCopyMarkerGroups": len(explicit_copy),
        "numberedSiblingReviewGroups": len(numbered_review),
        "numberedSiblingRows": sum(len(item["siblings"]) for item in numbered_review),
    }
    (output / "identity-audit.json").write_text(
        json.dumps({
            "summary": summary,
            "splitViewCandidates": view_candidates,
            "crossModelShaCandidates": sha_candidates,
            "siblingSuffixCandidates": sibling_candidates,
        }, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )
    with (output / "split-view-candidates.csv").open("w", encoding="utf-8-sig", newline="") as handle:
        writer = csv.writer(handle)
        writer.writerow(["confidence", "category", "franchise", "folder", "family", "canonical_slug", "member_slugs"])
        for item in view_candidates:
            writer.writerow([
                item["confidence"], item["categorySlug"], item["franchiseSlug"],
                item["folderPathKey"], item["family"], item["canonicalSlug"],
                " | ".join(member["slug"] for member in item["members"]),
            ])
    with (output / "sibling-suffix-candidates.csv").open("w", encoding="utf-8-sig", newline="") as handle:
        writer = csv.writer(handle)
        writer.writerow(["kind", "category", "franchise", "folder", "base_slug", "sibling_slugs"])
        for item in sibling_candidates:
            writer.writerow([
                item["kind"], item["categorySlug"], item["franchiseSlug"],
                item["folderPathKey"], item["baseSlug"],
                " | ".join(member["slug"] for member in item["siblings"]),
            ])
    return summary


def main() -> int:
    parser = argparse.ArgumentParser(description="Audita identidade de produto e fichas fragmentadas por vistas.")
    parser.add_argument("models", type=Path, help="models.jsonl do bundle")
    parser.add_argument("--r2-root", type=Path, help="raiz r2 do bundle para detectar SHA exato entre modelos")
    parser.add_argument("--output", type=Path, default=Path(".identity-audit"))
    parser.add_argument("--fail-on-high", action="store_true", help="falha se houver grupo de vistas de alta confiança não consolidado")
    args = parser.parse_args()

    rows = load_models(args.models)
    view_candidates = split_view_candidates(rows)
    sha_candidates = cross_model_sha_candidates(rows, args.r2_root) if args.r2_root else []
    sibling_candidates = sibling_suffix_candidates(rows)
    summary = write_report(args.output, view_candidates, sha_candidates, sibling_candidates)
    print(json.dumps(summary, ensure_ascii=False))
    if args.fail_on_high and summary["highConfidenceGroups"]:
        return 2
    return 0


if __name__ == "__main__":
    sys.exit(main())
