#!/usr/bin/env python3
"""Read-only D1 inventory of SHA fingerprints from active published galleries.

Image bytes and user Drive paths never leave the source. A SHA hit is a review
hint, not sculpture identity or publication rights. Missing hits prove nothing.
"""
from __future__ import annotations

import argparse
import json
import os
import re
from pathlib import Path
from typing import Any

from audit_external_source_coverage import CoverageError, fetch_json


def query_rows(endpoint: str, token: str, sql: str, params: list[Any]) -> list[dict]:
    payload, _ = fetch_json(endpoint, token=token, body={"sql": sql, "params": params})
    if not isinstance(payload, dict) or payload.get("success") is not True:
        raise CoverageError("D1 SHA inventory query failed")
    stmts = payload.get("result")
    if (not isinstance(stmts, list) or len(stmts) != 1
            or not isinstance(stmts[0], dict)
            or stmts[0].get("success") is not True
            or not isinstance(stmts[0].get("results"), list)):
        raise CoverageError("D1 SHA inventory returned invalid result")
    return stmts[0]["results"]


def inventory(account_id: str, token: str, database_id: str,
              published_model_count: int) -> dict:
    if isinstance(published_model_count, bool) or not isinstance(published_model_count, int) or published_model_count <= 0:
        raise CoverageError("expected published count is invalid")
    endpoint = f"https://api.cloudflare.com/client/v4/accounts/{account_id}/d1/database/{database_id}/query"
    pairs: list[dict[str, str]] = []
    cursor = ("", "")
    while True:
        sql = (
            "SELECT s.source_sha256 AS sha, s.model_id AS model_id "
            "FROM model_image_sources s JOIN models m ON m.id=s.model_id "
            "WHERE m.published=1 AND s.gallery_version=m.gallery_version "
            "AND (s.source_sha256>? OR (s.source_sha256=? AND s.model_id>?)) "
            "ORDER BY s.source_sha256, s.model_id LIMIT ?"
        )
        page = query_rows(endpoint, token, sql, [cursor[0], cursor[0], cursor[1], 400])
        if len(page) > 400:
            raise CoverageError("D1 SHA page exceeded limit")
        for row in page:
            if not isinstance(row, dict):
                raise CoverageError("invalid D1 SHA row")
            sha, mid = row.get("sha"), row.get("model_id")
            if (not isinstance(sha, str) or re.fullmatch(r"[0-9a-f]{64}", sha) is None
                    or not isinstance(mid, str) or re.fullmatch(r"mdl_[0-9a-f]{20}", mid) is None
                    or (sha, mid) <= cursor):
                raise CoverageError("invalid, repeated or unordered SHA pair")
            cursor = sha, mid
            pairs.append({"sourceSha256": sha, "modelId": mid})
        if len(page) < 400:
            break

    sql = (
        "SELECT (SELECT COUNT(*) FROM models WHERE published=1) AS published_models,"
        "(SELECT COUNT(DISTINCT s.model_id) FROM model_image_sources s JOIN models m ON m.id=s.model_id "
        "WHERE m.published=1 AND s.gallery_version=m.gallery_version) AS indexed_models,"
        "(SELECT COUNT(*) FROM model_image_sources s JOIN models m ON m.id=s.model_id "
        "WHERE m.published=1 AND s.gallery_version=m.gallery_version) AS indexed_images"
    )
    totals = query_rows(endpoint, token, sql, [])
    if len(totals) != 1 or not isinstance(totals[0], dict):
        raise CoverageError("invalid SHA inventory totals")
    vals = [totals[0].get(k) for k in ("published_models", "indexed_models", "indexed_images")]
    if (any(isinstance(v, bool) or not isinstance(v, int) or v < 0 for v in vals)
            or vals[0] != published_model_count
            or vals[1] != len({p["modelId"] for p in pairs})
            or vals[2] != len(pairs)
            or vals[1] > vals[0]):
        raise CoverageError("published SHA inventory changed during read")

    return {
        "version": 1, "scope": "active_published_gallery_source_sha_read_only",
        "modelShaPairs": pairs,
        "summary": {
            "publishedModels": vals[0], "indexedModels": vals[1],
            "indexedImageRows": vals[2], "modelsWithoutIndex": vals[0] - vals[1],
            "allPublishedModelsIndexed": vals[0] == vals[1],
        },
        "snapshotAtomic": False,
        "missingShaProvesMissingSculpture": False,
        "sourceShaProvesSculptureIdentity": False,
        "identityApproved": False, "mediaPromotionAuthorized": False,
        "productionWrites": 0, "stagingWrites": 0,
        "imageBinariesDownloaded": 0,
    }


def main() -> None:
    cli = argparse.ArgumentParser()
    cli.add_argument("--published-models", type=Path, required=True)
    cli.add_argument("--output", type=Path, required=True)
    args = cli.parse_args()
    models = json.loads(args.published_models.read_text(encoding="utf-8"))
    if not isinstance(models, list) or not models:
        raise CoverageError("published models snapshot absent")
    account = os.environ["CLOUDFLARE_ACCOUNT_ID"]
    token = os.environ["CLOUDFLARE_API_TOKEN"]
    database = os.environ["CLOUDFLARE_D1_DATABASE_ID"]
    result = inventory(account, token, database, len(models))
    args.output.write_text(json.dumps(result, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(json.dumps(result["summary"], ensure_ascii=False))


if __name__ == "__main__":
    main()
