#!/usr/bin/env python3
"""Reconcile an R2 publish checkpoint against objects that already exist remotely.

This recovery tool never uploads or deletes objects. It is useful after an
interrupted publication or when the local checkpoint was lost while some
objects were already persisted in R2.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import os
import sys
from pathlib import Path
from typing import Any

from publish_r2 import (
    DEFAULT_BUCKET,
    Candidate,
    discover,
    env_required,
    load_state,
    make_r2_client,
    save_state,
)


def md5_file(path: Path) -> str:
    digest = hashlib.md5(usedforsecurity=False)
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def not_found(exc: Exception) -> bool:
    response = getattr(exc, "response", {})
    status = response.get("ResponseMetadata", {}).get("HTTPStatusCode")
    code = response.get("Error", {}).get("Code")
    return status == 404 or code in {"404", "NoSuchKey", "NotFound"}


def remote_identity(client, bucket: str, candidate: Candidate) -> tuple[str, str | None]:
    try:
        head = client.head_object(Bucket=bucket, Key=candidate.key)
    except Exception as exc:  # botocore remains optional in unit tests
        if not_found(exc):
            return "missing", None
        raise

    if int(head.get("ContentLength", -1)) != candidate.size:
        return "mismatch", None

    metadata = head.get("Metadata", {}) or {}
    if metadata.get("sha256") == candidate.sha256:
        return "verified", "sha256-metadata"

    etag = str(head.get("ETag", "")).strip().strip('"').lower()
    if etag and "-" not in etag and etag == md5_file(candidate.path):
        return "verified", "etag-md5"

    return "mismatch", None


def reconcile(
    bundle_root: Path,
    state_path: Path,
    bucket: str,
    client,
    apply: bool = False,
) -> dict[str, Any]:
    bundle_root = bundle_root.resolve()
    if not bundle_root.is_dir():
        raise FileNotFoundError(f"bundle R2 não encontrado: {bundle_root}")

    state = load_state(state_path)
    candidates = discover(bundle_root, state)
    objects = state["objects"]
    summary: dict[str, Any] = {
        "bucket": bucket,
        "objects": len(candidates),
        "verified": 0,
        "adopted": 0,
        "alreadyTracked": 0,
        "missing": 0,
        "mismatched": 0,
        "errors": [],
        "apply": apply,
    }

    for candidate in candidates:
        try:
            status, method = remote_identity(client, bucket, candidate)
        except Exception as exc:
            summary["errors"].append({"key": candidate.key, "error": f"{type(exc).__name__}: {exc}"})
            continue

        if status == "missing":
            summary["missing"] += 1
            continue
        if status == "mismatch":
            summary["mismatched"] += 1
            continue

        summary["verified"] += 1
        previous = objects.get(candidate.key, {})
        if previous.get("published_sha256") == candidate.sha256:
            summary["alreadyTracked"] += 1
        else:
            summary["adopted"] += 1

        if apply:
            objects[candidate.key] = {
                **previous,
                "size": candidate.size,
                "mtime_ns": candidate.mtime_ns,
                "sha256": candidate.sha256,
                "published_sha256": candidate.sha256,
                "content_type": candidate.content_type,
                "cache_control": candidate.cache_control,
                "remote_verified": True,
                "verified_via": method,
            }

    summary["pending"] = summary["missing"] + summary["mismatched"] + len(summary["errors"])
    if apply:
        save_state(state_path, state)
    return summary


def main() -> int:
    parser = argparse.ArgumentParser(description="Reconcilia um checkpoint local com objetos já existentes no R2.")
    parser.add_argument("bundle", type=Path, help="pasta .publish-bundle/r2")
    parser.add_argument("--state", type=Path, help="checkpoint; padrão: ao lado da pasta r2")
    parser.add_argument("--bucket", default=os.environ.get("R2_BUCKET", DEFAULT_BUCKET))
    parser.add_argument("--apply", action="store_true", help="grava no checkpoint os objetos remotos verificados")
    args = parser.parse_args()

    bundle_root = args.bundle.resolve()
    state_path = args.state.resolve() if args.state else bundle_root.parent / "r2-publish-state.json"

    try:
        client = make_r2_client(
            account_id=env_required("CLOUDFLARE_ACCOUNT_ID"),
            access_key_id=env_required("R2_ACCESS_KEY_ID"),
            secret_access_key=env_required("R2_SECRET_ACCESS_KEY"),
        )
        summary = reconcile(bundle_root, state_path, args.bucket, client, apply=args.apply)
    except (FileNotFoundError, RuntimeError, ValueError) as exc:
        print(f"ERRO: {exc}", file=sys.stderr)
        return 2

    print(json.dumps(summary, ensure_ascii=False))
    return 1 if summary["errors"] else 0


if __name__ == "__main__":
    sys.exit(main())
