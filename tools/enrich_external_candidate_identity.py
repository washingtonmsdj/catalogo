#!/usr/bin/env python3
"""Attach read-only production identity-review candidates to discovery evidence.

Name/search matches are review hints only. This tool never maps identity and never writes
Cloudflare state. For complete or incomplete staged products it queries possible production
name matches and materializes their production cover objects into the short-lived review
artifact so a human can compare sculptures directly before any missing media is staged.
"""
from __future__ import annotations

import argparse
import html
import json
import os
import re
import unicodedata
import urllib.parse
import urllib.request
from pathlib import Path
from typing import Any

USER_AGENT = "catalog-external-identity-review/1.0"
MAX_REVIEW_CANDIDATES = 100
MAX_PRIORITY_OWNER_CANDIDATES = 3
IDENTITY_REVIEW_STATES = {
    "visual_review_required",
    "identity_review_required_exact_sha_overlap",
    "incomplete_staging",
}


def load_json(path: Path) -> dict[str, Any]:
    data = json.loads(path.read_text(encoding="utf-8"))
    if not isinstance(data, dict):
        raise RuntimeError(f"objeto JSON esperado: {path}")
    return data


def decode_b64_text(value: Any, field: str) -> str:
    raw = str(value or "").strip()
    if not raw:
        raise RuntimeError(f"{field} ausente")
    try:
        import base64
        decoded = base64.b64decode(raw, validate=True).decode("utf-8")
    except (ValueError, UnicodeDecodeError) as exc:
        raise RuntimeError(f"{field} inválido") from exc
    if not decoded:
        raise RuntimeError(f"{field} vazio")
    return decoded


def subject_hint(value: str) -> str:
    text = html.unescape(str(value or "")).strip()
    text = re.sub(r"\s+", " ", text)
    text = re.split(r"\bSTL\b", text, maxsplit=1, flags=re.IGNORECASE)[0].strip(" -–—")
    if len(text) >= 3:
        return text
    return html.unescape(str(value or "")).strip()


def alias_hints(hint: str) -> list[str]:
    """Bounded alternate name hints; NEVER an identity decision or new-model proof."""
    raw = unicodedata.normalize("NFKD", html.unescape(str(hint or ""))).strip()
    raw = "".join(char for char in raw if not unicodedata.combining(char))
    raw = re.sub(r"\s+", " ", raw.replace("’", "'").replace("‘", "'"))
    candidates: list[str] = []
    if "'" in raw:
        candidates.extend([raw.replace("'", ""), raw.replace("'", " ")])
    pieces = re.split(r"\s+(?:and|e)\s+|\s*[&+]\s*", raw, flags=re.IGNORECASE)
    if len(pieces) == 2:
        candidates.extend(pieces)
    aliases = []
    seen = {raw.casefold()}
    for candidate in candidates:
        alias = re.sub(r"\s+", " ", candidate).strip()
        if len(alias) < 4 or len(alias) > 72 or alias.casefold() in seen:
            continue
        seen.add(alias.casefold())
        aliases.append(alias)
    return aliases[:4]


def sql_like_literal(value: str) -> str:
    """Escape LIKE wildcards so names cannot broaden unbounded wildcard scans."""
    return "%" + value.casefold().replace("!", "!!").replace("%", "!%").replace("_", "!_") + "%"


def identity_review_state_supported(state: str) -> bool:
    return str(state or "") in IDENTITY_REVIEW_STATES


def post_json(url: str, payload: dict[str, Any], token: str) -> Any:
    body = json.dumps(payload, separators=(",", ":")).encode("utf-8")
    request = urllib.request.Request(
        url,
        data=body,
        method="POST",
        headers={
            "Authorization": f"Bearer {token}",
            "Content-Type": "application/json",
            "Accept": "application/json",
            "User-Agent": USER_AGENT,
        },
    )
    with urllib.request.urlopen(request, timeout=45) as response:
        return json.loads(response.read().decode("utf-8"))


def find_candidates(
    account_id: str, token: str, database_id: str, hint: str,
    *, selected_model_id: str | None = None,
) -> list[dict[str, Any]]:
    endpoint = f"https://api.cloudflare.com/client/v4/accounts/{account_id}/d1/database/{database_id}/query"
    # A priority cohort is already scoped by one canonical candidate ID.
    # Avoid broad substring search (Neo => unrelated Neon franchises).
    if selected_model_id is not None:
        if not selected_model_id.startswith("mdl_"):
            raise RuntimeError("invalid priority model ID")
        result = post_json(endpoint, {
            "sql": (
                "SELECT id,name,slug,code,image_count,cover_storage_key "
                "FROM models WHERE published=1 AND id=? LIMIT 2"
            ),
            "params": [selected_model_id],
        }, token)
        if not result.get("success"):
            raise RuntimeError(f"falha na consulta D1 canônica: {result.get('errors')}")
        rows = [row for item in result.get("result") or [] for row in item.get("results") or []]
        if len(rows) != 1 or rows[0].get("id") != selected_model_id:
            raise RuntimeError("priority canonical model missing or ambiguous in D1")
        return [{**rows[0], "_matchBasis": "priority_canonical_id_review_only"}]
    pattern = f"%{hint.casefold()}%"
    payload = post_json(
        endpoint,
        {
            "sql": (
                "SELECT id,name,slug,code,image_count,cover_storage_key "
                "FROM models WHERE published=1 AND (lower(name) LIKE ? OR lower(search_text) LIKE ?) "
                "ORDER BY CASE WHEN lower(name)=? THEN 0 ELSE 1 END,name,slug LIMIT ?"
            ),
            "params": [pattern, pattern, hint.casefold(), MAX_REVIEW_CANDIDATES],
        },
        token,
    )
    if not payload.get("success"):
        raise RuntimeError(f"falha na consulta D1: {payload.get('errors')}")
    rows: list[dict[str, Any]] = []
    for result in payload.get("result") or []:
        rows.extend(result.get("results") or [])
    if rows:
        return rows

    # The canonical name can differ in apostrophes or joined-character labels.
    # Fallback remains small and read-only; it only produces visual candidates.
    aliases = alias_hints(hint)
    if not aliases:
        return []
    predicates = ["(lower(name) LIKE ? ESCAPE '!' OR lower(search_text) LIKE ? ESCAPE '!')" for _ in aliases]
    patterns = [pattern for alias in aliases for pattern in (sql_like_literal(alias),) * 2]
    fallback = post_json(
        endpoint,
        {
            "sql": (
                "SELECT id,name,slug,code,image_count,cover_storage_key "
                "FROM models WHERE published=1 AND (" + " OR ".join(predicates) + ") "
                "ORDER BY name,slug LIMIT ?"
            ),
            "params": [*patterns, 12],
        },
        token,
    )
    if not fallback.get("success"):
        raise RuntimeError(f"falha na consulta D1 alias: {fallback.get('errors')}")
    seen: set[str] = set()
    for result in fallback.get("result") or []:
        for row in result.get("results") or []:
            model_id = str(row.get("id") or "")
            if not model_id or model_id in seen:
                continue
            seen.add(model_id)
            rows.append({**row, "_matchBasis": "alias_fallback_review_only"})
    return rows


def source_sha_owner_hints(product: dict[str, Any]) -> dict[str, list[dict[str, Any]]]:
    """Correlate exact source SHA owners without granting model or media approval."""
    hints: dict[str, list[dict[str, Any]]] = {}
    for image in product.get("images") or []:
        if not isinstance(image, dict):
            raise RuntimeError("invalid source image provenance")
        owners = image.get("productionOwners") or []
        if not isinstance(owners, list):
            raise RuntimeError("invalid model_image_sources owners")
        sha = image.get("sha256")
        pos = image.get("position")
        if owners and (
            not isinstance(sha, str) or re.fullmatch(r"[a-f0-9]{64}", sha) is None
            or isinstance(pos, bool) or not isinstance(pos, int) or pos < 1
        ):
            raise RuntimeError("invalid source SHA ownership proof")
        for owner in owners:
            if not isinstance(owner, str) or re.fullmatch(r"mdl_[a-zA-Z0-9]+", owner) is None:
                raise RuntimeError("invalid exact-source owner model ID")
            records = hints.setdefault(owner, [])
            evidence = {"sourcePosition": pos, "sourceSha256": sha}
            if evidence not in records:
                records.append(evidence)
    if len(hints) > MAX_PRIORITY_OWNER_CANDIDATES + 1:
        raise RuntimeError("too many exact-source owners; manual investigation required")
    return hints


def lookup_published_source_owners(
    account_id: str, token: str, database_id: str, owner_model_ids: list[str]
) -> list[dict[str, Any]]:
    """Fetch published owner IDs via a bounded parameterized D1 read-only query."""
    if not owner_model_ids:
        return []
    if len(owner_model_ids) > MAX_PRIORITY_OWNER_CANDIDATES or len(set(owner_model_ids)) != len(owner_model_ids):
        raise RuntimeError("invalid priority source owner batch")
    if any(not isinstance(mid, str) or re.fullmatch(r"mdl_[a-zA-Z0-9]+", mid) is None for mid in owner_model_ids):
        raise RuntimeError("invalid priority source owner model ID")
    endpoint = f"https://api.cloudflare.com/client/v4/accounts/{account_id}/d1/database/{database_id}/query"
    markers = ",".join("?" for _ in owner_model_ids)
    payload = post_json(endpoint, {
        "sql": (
            "SELECT id,name,slug,code,image_count,cover_storage_key "
            f"FROM models WHERE published=1 AND id IN ({markers}) ORDER BY id LIMIT ?"
        ),
        "params": [*owner_model_ids, len(owner_model_ids) + 1],
    }, token)
    if not payload.get("success"):
        raise RuntimeError(f"falha na verificação D1 de owner: {payload.get('errors')}")
    owners = [row for res in payload.get("result") or [] for row in res.get("results") or []]
    returned: set[str] = set()
    for owner in owners:
        model_id = owner.get("id")
        if model_id not in owner_model_ids or model_id in returned:
            raise RuntimeError("source SHA owner query returned unexpected/duplicate model")
        returned.add(model_id)
    return [{**owner, "_matchBasis": "exact_source_sha_owner_review_only"} for owner in owners]


def download_r2_object(account_id: str, token: str, bucket: str, key: str, destination: Path) -> int:
    encoded_key = urllib.parse.quote(key, safe="/")
    url = f"https://api.cloudflare.com/client/v4/accounts/{account_id}/r2/buckets/{bucket}/objects/{encoded_key}"
    request = urllib.request.Request(url, headers={"Authorization": f"Bearer {token}", "User-Agent": USER_AGENT})
    destination.parent.mkdir(parents=True, exist_ok=True)
    total = 0
    with urllib.request.urlopen(request, timeout=45) as response, destination.open("wb") as handle:
        while True:
            chunk = response.read(1024 * 1024)
            if not chunk:
                break
            total += len(chunk)
            if total > 8 * 1024 * 1024:
                raise RuntimeError("capa de revisão excede limite de 8 MiB")
            handle.write(chunk)
    if total < 1:
        raise RuntimeError("capa de produção vazia")
    return total


def priority_scope(batch_path: Path, report: dict[str, Any]) -> dict[int, str]:
    batch = load_json(batch_path)
    rows = batch.get("selected")
    if not isinstance(rows, list) or not 1 <= len(rows) <= 3:
        raise RuntimeError("invalid priority review cohort")
    expected_ids = batch.get("selectedProductIds")
    if not isinstance(expected_ids, list) or len(expected_ids) != len(rows):
        raise RuntimeError("priority cohort ID list mismatch")
    if report.get("requestedProductIds") != expected_ids:
        raise RuntimeError("priority cohort differs from downloaded review products")
    scope: dict[int, str] = {}
    candidates: set[str] = set()
    for index, row in enumerate(rows):
        if not isinstance(row, dict) or row.get("identityApproved") is not False or row.get("mediaPromotionAuthorized") is not False:
            raise RuntimeError("priority review-only guard violated")
        pid = row.get("sourceProductId")
        mid = row.get("candidateModelId")
        if (isinstance(pid, bool) or not isinstance(pid, int) or pid <= 0
                or pid != expected_ids[index] or pid in scope
                or not isinstance(mid, str) or not mid.startswith("mdl_")
                or mid in candidates):
            raise RuntimeError("invalid or duplicate priority candidate")
        scope[pid] = mid
        candidates.add(mid)
    if batch.get("productionWrites") != 0 or batch.get("stagingWrites") != 0:
        raise RuntimeError("priority cohort cannot authorize writes")
    return scope


def enrich(
    report_path: Path, descriptor_path: Path, review_root: Path,
    priority_batch_path: Path | None = None,
) -> dict[str, Any]:
    report = load_json(report_path)
    descriptor = load_json(descriptor_path)
    production_bucket = str(descriptor.get("productionBucket") or "").strip()
    account_id = str(os.environ.get("CLOUDFLARE_ACCOUNT_ID") or "").strip()
    token = str(os.environ.get("CLOUDFLARE_API_TOKEN") or "").strip()
    database_id = str(os.environ.get("CLOUDFLARE_D1_DATABASE_ID") or "").strip()
    if not production_bucket or not account_id or not token or not database_id:
        raise RuntimeError("bindings de revisão ausentes")

    scope = priority_scope(priority_batch_path, report) if priority_batch_path is not None else None
    materialized = 0
    reviewed_products = 0
    for product in report.get("products") or []:
        state = str(product.get("state") or "")
        if not identity_review_state_supported(state):
            continue
        hint = subject_hint(str(product.get("productName") or ""))
        if scope is not None and product.get("productId") not in scope:
            raise RuntimeError("review product outside selected priority cohort")
        matches = find_candidates(
            account_id, token, database_id, hint,
            selected_model_id=scope[product["productId"]] if scope is not None else None,
        )
        # Preserve exact-SHA model_image_sources owners even when the canonical
        # title search returned another sculpture. This is a review lead only.
        owner_hints = source_sha_owner_hints(product) if scope is not None else {}
        owner_ids = [owner for owner in owner_hints if owner not in {row.get("id") for row in matches}]
        extra_owners = lookup_published_source_owners(
            account_id, token, database_id, owner_ids
        ) if owner_ids else []
        matches.extend(extra_owners)
        product["sourceShaOwnerReviewHints"] = owner_hints
        product["sourceShaOwnersWithoutPublishedModel"] = [
            owner for owner in owner_ids if owner not in {row.get("id") for row in extra_owners}
        ]
        review_candidates: list[dict[str, Any]] = []
        for row in matches:
            model_id = str(row.get("id") or "")
            key = str(row.get("cover_storage_key") or "")
            item = {
                "modelId": model_id,
                "name": str(row.get("name") or ""),
                "slug": str(row.get("slug") or ""),
                "code": str(row.get("code") or ""),
                "imageCount": int(row.get("image_count") or 0),
                "coverStorageKey": key,
                "matchBasis": str(row.get("_matchBasis") or "name_or_search_hint_review_only"),
                "sourceShaOverlapEvidence": owner_hints.get(model_id, []),
            }
            if model_id and key.startswith("media/"):
                ext = Path(key).suffix.lower() or ".bin"
                destination = review_root / f"product-{product['productId']}" / "production-candidates" / f"{model_id}{ext}"
                try:
                    item["coverBytes"] = download_r2_object(account_id, token, production_bucket, key, destination)
                    item["reviewArtifactPath"] = str(destination.relative_to(review_root.parent)).replace("\\", "/")
                    materialized += 1
                except Exception as exc:
                    item["coverMaterializationError"] = str(exc)
            review_candidates.append(item)
        product["identityReviewHint"] = hint
        product["identityReviewAliasesChecked"] = alias_hints(hint) if not any(
            candidate["matchBasis"] == "name_or_search_hint_review_only"
            for candidate in review_candidates
        ) else []
        product["identityReviewCandidates"] = review_candidates
        product["identityDecision"] = "unresolved"
        product["promotable"] = False
        reviewed_products += 1

    report["identityReviewProducts"] = reviewed_products
    report["productionCoverReviewObjects"] = materialized
    report["productionWrites"] = 0
    report["stagingWrites"] = 0
    report_path.write_text(json.dumps(report, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    print(json.dumps({
        "identityReviewProducts": reviewed_products,
        "productionCoverReviewObjects": materialized,
        "identityDecisions": 0,
        "productionWrites": 0,
        "stagingWrites": 0,
    }, ensure_ascii=False))
    return report


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("report")
    parser.add_argument("--descriptor", default="config/external-batches/external-source-001-batch-004.json")
    parser.add_argument("--review-root", required=True)
    parser.add_argument("--priority-batch", default=None,
                        help="Constrain priority visual review to exact selected model IDs")
    return parser.parse_args()


if __name__ == "__main__":
    args = parse_args()
    enrich(Path(args.report), Path(args.descriptor), Path(args.review_root),
           Path(args.priority_batch) if args.priority_batch else None)
