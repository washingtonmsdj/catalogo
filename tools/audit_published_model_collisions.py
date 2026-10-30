#!/usr/bin/env python3
"""Read-only catalog-wide model collision audit.

Input: JSON array of published D1 model rows (id, name, slug, franchise_id).
This detects *candidate* collisions, never declares identical sculptures.
"""
from __future__ import annotations

import argparse
import json
import unicodedata
from collections import defaultdict
from pathlib import Path


def normalize(value: object) -> str:
    return " ".join(unicodedata.normalize("NFKC", str(value or "")).casefold().split())


def audit(models: list[dict]) -> dict:
    if not isinstance(models, list) or not models:
        raise ValueError("nonempty models array required")
    ids = set()
    names = defaultdict(list)
    slugs = defaultdict(list)
    missing = []
    metadata = {}
    for model in models:
        if not isinstance(model, dict):
            raise ValueError("invalid model row")
        mid = model.get("id")
        if not isinstance(mid, str) or not mid or mid in ids:
            raise ValueError("missing or repeated model ID")
        ids.add(mid)
        metadata[mid] = {"modelId": mid, "slug": str(model.get("slug") or ""),
                         "code": str(model.get("code") or ""),
                         "imageCount": model.get("image_count"),
                         "franchiseName": str(model.get("franchise_name") or "")}
        name = normalize(model.get("name"))
        slug = normalize(model.get("slug"))
        franchise = normalize(model.get("franchise_id"))
        if not name or not slug:
            missing.append(mid)
        # Name and slug are independent collision indices: a missing slug
        # cannot hide a valid same-name collision (or vice versa).
        if name:
            names[(franchise, name)].append(mid)
        if slug:
            slugs[slug].append(mid)

    def groups(index):
        return [{"key": list(key) if isinstance(key, tuple) else key,
                 "modelIds": sorted(values),
                 "modelMetadata": [metadata[mid] for mid in sorted(values)]}
                for key, values in sorted(index.items()) if len(values) > 1]

    return {
        "schemaVersion": 1,
        "scope": "published-model-records-input-only",
        "totalRecords": len(models),
        "uniqueRecordIds": len(ids),
        "missingNameOrSlug": sorted(missing),
        "exactSlugCollisions": groups(slugs),
        "sameFranchiseNormalizedNameCollisions": groups(names),
        "certifiedUniqueSculptures": None,
        "sculptureUniquenessProven": False,
        "mutationAuthorized": False,
        "classification": "review_only",
    }


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("models_json", type=Path)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    rows = json.loads(args.models_json.read_text(encoding="utf-8"))
    result = audit(rows)
    args.output.write_text(json.dumps(result, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(json.dumps({key: result[key] for key in ("totalRecords", "uniqueRecordIds", "sculptureUniquenessProven") }))


if __name__ == "__main__":
    main()
