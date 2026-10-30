#!/usr/bin/env python3
"""Audit external-source coverage against the published catalog without media downloads.

This report is intentionally conservative. A product is counted as confirmed present only
when versioned review evidence explicitly maps it to an existing model, or when a reviewed
new model's deterministic model id is already published. Name similarity and candidate
metadata are review-only and never authorize identity resolution by themselves.
"""
from __future__ import annotations

import argparse
import base64
import html
import json
import os
import re
import unicodedata
import urllib.error
import urllib.parse
import urllib.request
import time
from collections import Counter, defaultdict
from pathlib import Path
from typing import Any

USER_AGENT = "catalog-external-coverage/1.0"
TAG_RE = re.compile(r"<[^>]+>")
SPACE_RE = re.compile(r"\s+")
STL_SPLIT_RE = re.compile(r"\bSTL\b", re.IGNORECASE)
MAX_ALIAS_REVIEW_CANDIDATES = 24


class CoverageError(RuntimeError):
    pass


def load_json(path: Path) -> Any:
    return json.loads(path.read_text(encoding="utf-8"))


def normalize(value: Any) -> str:
    text = html.unescape(TAG_RE.sub(" ", str(value or "")))
    text = unicodedata.normalize("NFKC", text).casefold()
    return SPACE_RE.sub(" ", text).strip()


def subject_hint(name: str) -> str:
    text = html.unescape(str(name or "")).strip()
    prefix = STL_SPLIT_RE.split(text, maxsplit=1)[0].strip(" -–—")
    return prefix or text


def review_alias_hints(name: str, categories: list[str]) -> list[str]:
    """Create title/category review hints, never approved identity or media."""
    text = html.unescape(str(name or "")).strip()
    segments = re.split(r"\s+[-–—]\s+", text)
    trailing_labels = {normalize(value) for value in categories}
    trailing_labels.add("stl files")
    choices: list[str] = []
    while len(segments) > 1 and normalize(segments[-1]) in trailing_labels:
        segments.pop()
        choices.append(" – ".join(segments))
    candidates = [subject_hint(choice) for choice in choices] + choices
    candidates.append(subject_hint(text))
    aliases: list[str] = []
    seen = {normalize(subject_hint(text))}
    for candidate in candidates:
        variants = [
            candidate,
            re.sub(
                r"(?:\s*\+\s*(?:extras?|bust(?:o)?|nsfw|poster))+$",
                "",
                candidate,
                flags=re.IGNORECASE,
            ).strip(),
        ]
        for alias in variants:
            if 3 <= len(alias) <= 100 and normalize(alias) not in seen:
                seen.add(normalize(alias))
                aliases.append(alias)
    return aliases[:8]


def decode_origin(descriptor: dict[str, Any]) -> str:
    raw = str(descriptor.get("sourceOriginB64") or "").strip()
    if not raw:
        raise CoverageError("sourceOriginB64 ausente")
    try:
        origin = base64.b64decode(raw, validate=True).decode("utf-8").rstrip("/")
    except (ValueError, UnicodeDecodeError) as exc:
        raise CoverageError("sourceOriginB64 inválido") from exc
    parsed = urllib.parse.urlparse(origin)
    if parsed.scheme != "https" or not parsed.netloc:
        raise CoverageError("source origin deve ser HTTPS")
    return origin


def fetch_json(url: str, *, token: str | None = None, body: dict[str, Any] | None = None) -> tuple[Any, Any]:
    headers = {"Accept": "application/json", "User-Agent": USER_AGENT}
    data = None
    method = "GET"
    if token:
        headers["Authorization"] = f"Bearer {token}"
    if body is not None:
        headers["Content-Type"] = "application/json"
        data = json.dumps(body, separators=(",", ":")).encode("utf-8")
        method = "POST"
    request = urllib.request.Request(url, data=data, method=method, headers=headers)
    # The public WordPress source occasionally emits transient 403/429/5xx at
    # the edge. Retry read-only anonymous GET only, as in candidate discovery.
    # Never retry authenticated Cloudflare errors or any POST/query, and never
    # treat a failed/partial page as a successful coverage snapshot.
    anonymous_read = method == "GET" and token is None
    max_attempts = 4 if anonymous_read else 1
    for attempt in range(max_attempts):
        try:
            with urllib.request.urlopen(request, timeout=45) as response:
                payload = json.loads(response.read().decode("utf-8"))
                return payload, response.headers
        except urllib.error.HTTPError as exc:
            transient = exc.code in {403, 408, 425, 429} or 500 <= exc.code <= 599
            if not anonymous_read or not transient or attempt + 1 >= max_attempts:
                raise
        except (urllib.error.URLError, TimeoutError):
            if not anonymous_read or attempt + 1 >= max_attempts:
                raise
        time.sleep(2 ** attempt)
    raise CoverageError("anonymous source request exhausted retry budget")


def fetch_source_products(origin: str, *, per_page: int = 100, max_pages: int = 100) -> tuple[list[dict[str, Any]], dict[str, int]]:
    if per_page < 1 or per_page > 100:
        raise CoverageError("per_page deve ficar entre 1 e 100")
    params = {
        "per_page": per_page,
        "page": 1,
        "orderby": "id",
        "order": "asc",
        "_fields": "id,name,slug,categories",
    }
    first_url = f"{origin}/wp-json/wc/store/v1/products?{urllib.parse.urlencode(params)}"
    first, headers = fetch_json(first_url)
    if not isinstance(first, list):
        raise CoverageError("Store API não retornou array de produtos")
    try:
        total = int(headers.get("X-WP-Total") or headers.get("x-wp-total") or len(first))
        total_pages = int(headers.get("X-WP-TotalPages") or headers.get("x-wp-totalpages") or 1)
    except ValueError as exc:
        raise CoverageError("headers de paginação inválidos") from exc
    if total < 1 or total_pages < 1 or total_pages > max_pages:
        raise CoverageError(f"paginação de origem inválida: total={total} páginas={total_pages}")
    expected_pages = (total + per_page - 1) // per_page
    if total_pages != expected_pages:
        raise CoverageError(f"paginação de origem inconsistente: páginas={total_pages}, esperado={expected_pages}")
    products = list(first)
    for page in range(2, total_pages + 1):
        params["page"] = page
        payload, _ = fetch_json(f"{origin}/wp-json/wc/store/v1/products?{urllib.parse.urlencode(params)}")
        if not isinstance(payload, list):
            raise CoverageError(f"Store API página {page} inválida")
        products.extend(payload)
    if len(products) != total:
        raise CoverageError(f"snapshot incompleto da fonte: {len(products)} produtos != total informado {total}")
    if any(not isinstance(item, dict) for item in products):
        raise CoverageError("Store API contém item que não é objeto")
    try:
        ids = [int(item.get("id") or 0) for item in products]
    except (TypeError, ValueError) as exc:
        raise CoverageError("IDs de produto inválidos") from exc
    if any(value <= 0 for value in ids) or any(left >= right for left, right in zip(ids, ids[1:])):
        raise CoverageError("IDs de produto inválidos, duplicados ou fora de ordem id_asc")
    return products, {
        "reportedTotal": total,
        "totalPages": total_pages,
        "productsFetched": len(products),
        "ordering": "id_asc",
    }


def fetch_published_models(account_id: str, token: str, database_id: str) -> list[dict[str, Any]]:
    endpoint = f"https://api.cloudflare.com/client/v4/accounts/{account_id}/d1/database/{database_id}/query"
    payload, _ = fetch_json(
        endpoint,
        token=token,
        body={
            "sql": (
                "SELECT m.id,m.name,m.slug,m.code,m.image_count,m.franchise_id,"
                "f.name AS franchise_name,f.slug AS franchise_slug "
                "FROM models m LEFT JOIN franchises f ON f.id=m.franchise_id "
                "WHERE m.published=1 ORDER BY m.id"
            )
        },
    )
    if not isinstance(payload, dict) or payload.get("success") is not True:
        raise CoverageError(f"consulta D1 falhou: {payload.get('errors') if isinstance(payload, dict) else payload}")
    rows: list[dict[str, Any]] = []
    for result in payload.get("result") or []:
        rows.extend(result.get("results") or [])
    return rows


def fetch_shared_published_sha_groups(account_id: str, token: str, database_id: str) -> dict[str, Any]:
    """Read-only positive shared-SHA hints in active galleries; never download media."""
    endpoint = f"https://api.cloudflare.com/client/v4/accounts/{account_id}/d1/database/{database_id}/query"
    groups: list[dict[str, Any]] = []
    cursor = ""
    while True:
        payload, _ = fetch_json(endpoint, token=token, body={
            "sql": (
                "SELECT s.source_sha256 AS sha, "
                "GROUP_CONCAT(DISTINCT s.model_id) AS model_ids "
                "FROM model_image_sources s JOIN models m ON m.id=s.model_id "
                "WHERE m.published=1 AND s.gallery_version=m.gallery_version "
                "AND s.source_sha256>? GROUP BY s.source_sha256 "
                "HAVING COUNT(DISTINCT s.model_id)>1 "
                "ORDER BY s.source_sha256 LIMIT ?"
            ),
            "params": [cursor, 200],
        })
        if not isinstance(payload, dict) or payload.get("success") is not True:
            raise CoverageError("consulta SHA do catálogo falhou")
        statements = payload.get("result")
        if (not isinstance(statements, list) or len(statements) != 1
                or not isinstance(statements[0], dict)
                or statements[0].get("success") is not True
                or not isinstance(statements[0].get("results"), list)):
            raise CoverageError("resposta SHA do D1 inválida")
        rows = statements[0]["results"]
        if len(rows) > 200:
            raise CoverageError("página SHA excedeu limite")
        for row in rows:
            if not isinstance(row, dict):
                raise CoverageError("registro SHA inválido")
            sha, ids = row.get("sha"), row.get("model_ids")
            if not isinstance(sha, str) or re.fullmatch(r"[0-9a-f]{64}", sha) is None or sha <= cursor:
                raise CoverageError("SHA inválido ou paginação sem avanço")
            if not isinstance(ids, str):
                raise CoverageError("lista de modelos SHA inválida")
            models = ids.split(",")
            if (len(models) < 2 or len(models) != len(set(models))
                    or any(not mid.startswith("mdl_") or len(mid) <= 4 for mid in models)):
                raise CoverageError("identidades inválidas no índice SHA")
            groups.append({"sourceSha256": sha, "modelIds": sorted(models)})
            cursor = sha
        if len(rows) < 200:
            break
    return {
        "version": 1,
        "scope": "active_published_gallery_shared_sha_positive_evidence_only",
        "groups": groups,
        "imageIndexCompletenessProven": False,
        "identityApproved": False,
        "mergeAuthorized": False,
        "productionWrites": 0,
        "stagingWrites": 0,
        "imageBinariesDownloaded": 0,
    }


def batch_model_ids(root: Path) -> dict[int, str]:
    """Require a single unambiguous canonical model target across every release batch."""
    result: dict[int, str] = {}
    for path in sorted(root.glob("external-source-001-batch-*.json")):
        try:
            payload = load_json(path)
        except (OSError, json.JSONDecodeError) as exc:
            raise CoverageError(f"descritor de batch ilegível: {path.name}") from exc
        if not isinstance(payload, dict) or not isinstance(payload.get("products"), list):
            raise CoverageError(f"estrutura de batch inválida: {path.name}")
        for product in payload["products"]:
            if not isinstance(product, dict):
                raise CoverageError(f"produto de batch inválido: {path.name}")
            product_id = product.get("productId")
            model_id = product.get("expectedModelId")
            if (isinstance(product_id, bool) or not isinstance(product_id, int)
                    or product_id <= 0 or not isinstance(model_id, str)
                    or not model_id.startswith("mdl_") or len(model_id) <= 4
                    or model_id != model_id.strip()):
                raise CoverageError(f"identidade de batch inválida: {path.name}")
            previous = result.get(product_id)
            if previous is not None and previous != model_id:
                raise CoverageError(f"modelos divergentes para produto {product_id} entre batches")
            result[product_id] = model_id
    return result


def review_evidence(root: Path) -> tuple[dict[int, set[str]], dict[int, set[str]]]:
    """Read evidence once, retaining only explicitly approved, unambiguous map targets."""
    states: dict[int, set[str]] = defaultdict(set)
    existing_targets: dict[int, set[str]] = defaultdict(set)
    for path in sorted(root.glob("external-source-001-*.json")):
        try:
            payload = load_json(path)
        except (OSError, json.JSONDecodeError) as exc:
            # A damaged identity review cannot safely be mistaken for an
            # unreviewed product and must not silently disappear from coverage.
            raise CoverageError(f"evidência de identidade ilegível: {path.name}") from exc
        if not isinstance(payload, dict) or "sourceProductId" not in payload:
            continue  # valid non-product reports are not identity reviews
        raw_id = payload["sourceProductId"]
        if isinstance(raw_id, bool) or not (
            isinstance(raw_id, int)
            or (isinstance(raw_id, str) and raw_id.isascii() and raw_id.isdecimal())
        ):
            raise CoverageError(f"ID de produto inválido em {path.name}")
        product_id = int(raw_id)
        if product_id <= 0:
            raise CoverageError(f"ID de produto inválido em {path.name}")
        raw_identity = payload.get("identityReview")
        if raw_identity is not None and not isinstance(raw_identity, dict):
            raise CoverageError(f"revisão de identidade inválida em {path.name}")
        identity = raw_identity or {}
        decision = str(identity.get("decision") or "").strip()
        if decision in {"map_existing", "unresolved"}:
            states[product_id].add(decision)
        top_decision = payload.get("decision") or {}
        if not isinstance(top_decision, dict):
            raise CoverageError(f"decisão de identidade inválida em {path.name}")
        approved_new_model = (top_decision.get("newModelAuthorized") is True
                              or top_decision.get("newModelIdentityAuthorized") is True)
        if approved_new_model and top_decision.get("identityResolved") is False:
            raise CoverageError(f"aprovação new_model contradiz identidade não resolvida em {path.name}")
        if approved_new_model:
            states[product_id].add("new_model")
        elif decision == "new_model":
            states[product_id].add("unresolved")
        if top_decision.get("identityResolved") is False:
            states[product_id].add("unresolved")
        if top_decision.get("galleryMediaReviewApproved") is False:
            states[product_id].add("media_blocked_or_pending")
        if str(payload.get("watermarkStatus") or "") == "watermarked":
            states[product_id].add("media_blocked_or_pending")
        if decision == "map_existing":
            production_evidence = payload.get("productionEvidence")
            if production_evidence is not None and not isinstance(production_evidence, dict):
                raise CoverageError(f"prova de produção inválida em {path.name}")
            approved = (
                identity.get("mapExistingApproved") is True
                or top_decision.get("mapExistingAuthorized") is True
                or top_decision.get("mapExistingApproved") is True
                or top_decision.get("identityResolved") is True
            )
            if approved and top_decision.get("identityResolved") is False:
                raise CoverageError(f"aprovação map_existing contradiz identidade não resolvida em {path.name}")
            if approved:
                target_ids = {
                    str(candidate or "").strip()
                    for candidate in (
                        identity.get("targetModelId"),
                        top_decision.get("canonicalModelId"),
                        (production_evidence or {}).get("modelId"),
                    )
                    if str(candidate or "").strip()
                }
                if len(target_ids) > 1:
                    raise CoverageError(f"alvos map_existing divergentes em {path.name}")
                if target_ids:
                    target_id = next(iter(target_ids))
                    if not target_id.startswith("mdl_"):
                        raise CoverageError(f"target map_existing inválido em {path.name}")
                    existing_targets[product_id].add(target_id)
    for product_id, target_ids in existing_targets.items():
        if len(target_ids) > 1:
            raise CoverageError(f"alvos map_existing divergentes entre evidências para produto {product_id}")
    return states, existing_targets


def category_names(product: dict[str, Any]) -> list[str]:
    values: list[str] = []
    for row in product.get("categories") or []:
        if isinstance(row, dict):
            name = str(row.get("name") or "").strip()
        else:
            name = str(row or "").strip()
        if name and name not in values:
            values.append(name)
    return values


def candidate_metadata(model: dict[str, Any]) -> dict[str, Any]:
    return {
        "modelId": str(model.get("id") or ""),
        "name": str(model.get("name") or ""),
        "slug": str(model.get("slug") or ""),
        "code": str(model.get("code") or ""),
        "imageCount": int(model.get("image_count") or 0),
        "franchiseId": model.get("franchise_id"),
        "franchiseName": str(model.get("franchise_name") or ""),
        "franchiseSlug": str(model.get("franchise_slug") or ""),
    }


def classify(
    products: list[dict[str, Any]],
    models: list[dict[str, Any]],
    reviews: dict[int, set[str]],
    batch_ids: dict[int, str],
    existing_targets: dict[int, set[str]] | None = None,
) -> dict[str, Any]:
    published_ids = {str(row.get("id") or "") for row in models}
    existing_targets = existing_targets or {}
    names: dict[str, list[dict[str, Any]]] = defaultdict(list)
    for row in models:
        names[normalize(row.get("name"))].append(candidate_metadata(row))

    rows: list[dict[str, Any]] = []
    counts: Counter[str] = Counter()
    alias_sources_with_candidates = 0
    alias_candidate_links = 0
    for product in products:
        product_id = int(product["id"])
        name = str(product.get("name") or "")
        states = reviews.get(product_id, set())
        expected_id = batch_ids.get(product_id)
        candidates = names.get(normalize(subject_hint(name)), [])
        approved_targets = existing_targets.get(product_id, set())
        confirmed_target = (
            next(iter(approved_targets))
            if len(approved_targets) == 1 and next(iter(approved_targets)) in published_ids
            else None
        )
        if "map_existing" in states and confirmed_target:
            state = "confirmed_present_map_existing"
        elif "new_model" in states and expected_id and expected_id in published_ids:
            state = "confirmed_present_reviewed_new_model"
        elif "new_model" in states:
            state = "reviewed_new_model_not_published"
        elif states:
            state = "reviewed_unresolved"
        elif not candidates:
            state = "unreviewed_no_exact_name_candidate"
        elif len(candidates) == 1:
            state = "unreviewed_single_exact_name_candidate"
        else:
            state = "unreviewed_multiple_exact_name_candidates"
        counts[state] += 1
        source_categories = category_names(product)
        alias_hints = review_alias_hints(name, source_categories) if state == "unreviewed_no_exact_name_candidate" else []
        alias_matches: dict[str, dict[str, Any]] = {}
        for hint in alias_hints:
            for match in names.get(normalize(hint), []):
                alias_matches.setdefault(match["modelId"], match)
        alias_candidates = list(alias_matches.values())[:MAX_ALIAS_REVIEW_CANDIDATES]
        alias_truncated = len(alias_matches) > MAX_ALIAS_REVIEW_CANDIDATES
        if alias_candidates:
            alias_sources_with_candidates += 1
            alias_candidate_links += len(alias_candidates)
        rows.append(
            {
                "sourceProductId": product_id,
                "sourceName": name,
                "sourceSlug": str(product.get("slug") or ""),
                "sourceCategories": source_categories,
                "state": state,
                "expectedModelId": expected_id,
                "approvedExistingTargetModelId": confirmed_target,
                "reviewStates": sorted(states),
                "exactNameCandidates": candidates,
                "reviewAliasHints": alias_hints,
                "reviewAliasCandidates": alias_candidates,
                "reviewAliasCandidatesTruncated": alias_truncated,
                "candidateMetadataSemantics": "review_only",
            }
        )

    confirmed = counts["confirmed_present_map_existing"] + counts["confirmed_present_reviewed_new_model"]
    confirmed_missing = counts["reviewed_new_model_not_published"]
    return {
        "summary": {
            "sourceProducts": len(products),
            "publishedModels": len(models),
            "confirmedPresent": confirmed,
            "confirmedReviewedNewModelsNotPublished": confirmed_missing,
            "coverage100Proven": bool(products) and confirmed == len(products),
            "states": dict(sorted(counts.items())),
            "candidateMetadataSemantics": "review_only",
            "unreviewedAliasSuggestions": alias_sources_with_candidates,
            "unreviewedAliasCandidateLinks": alias_candidate_links,
            "productionWrites": 0,
            "stagingWrites": 0,
        },
        "products": rows,
    }


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("--source", default="config/external-sources/external-source-001.json")
    parser.add_argument("--evidence-root", default="docs/evidence")
    parser.add_argument("--batch-root", default="config/external-batches")
    parser.add_argument("--output", required=True)
    parser.add_argument("--published-models-output", default=None)
    parser.add_argument("--shared-image-sha-output", default=None)
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    descriptor = load_json(Path(args.source))
    origin = decode_origin(descriptor)
    account_id = str(os.environ.get("CLOUDFLARE_ACCOUNT_ID") or "").strip()
    token = str(os.environ.get("CLOUDFLARE_API_TOKEN") or "").strip()
    database_id = str(os.environ.get("CLOUDFLARE_D1_DATABASE_ID") or "").strip()
    if not account_id or not token or not database_id:
        raise CoverageError("bindings Cloudflare ausentes")
    products, source_meta = fetch_source_products(origin)
    models = fetch_published_models(account_id, token, database_id)
    if args.published_models_output:
        Path(args.published_models_output).write_text(
            json.dumps(models, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
        )
    if args.shared_image_sha_output:
        sha_index = fetch_shared_published_sha_groups(account_id, token, database_id)
        Path(args.shared_image_sha_output).write_text(
            json.dumps(sha_index, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
        )
    reviews, existing_targets = review_evidence(Path(args.evidence_root))
    report = classify(
        products,
        models,
        reviews,
        batch_model_ids(Path(args.batch_root)),
        existing_targets,
    )
    report["version"] = 2
    report["sourceId"] = str(descriptor.get("sourceId") or "")
    report["source"] = source_meta
    Path(args.output).write_text(json.dumps(report, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    print(json.dumps(report["summary"], ensure_ascii=False))


if __name__ == "__main__":
    main()
