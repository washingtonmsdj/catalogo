from __future__ import annotations

import hashlib
import json
import tempfile
import unittest
from pathlib import Path

from reconcile_r2_state import reconcile


class FakeNotFound(Exception):
    def __init__(self) -> None:
        self.response = {
            "ResponseMetadata": {"HTTPStatusCode": 404},
            "Error": {"Code": "NoSuchKey"},
        }
        super().__init__("not found")


class FakeR2:
    def __init__(self) -> None:
        self.objects: dict[tuple[str, str], dict] = {}

    def put(self, bucket: str, key: str, body: bytes, metadata: dict | None = None) -> None:
        etag = hashlib.md5(body, usedforsecurity=False).hexdigest()
        self.objects[(bucket, key)] = {
            "body": body,
            "Metadata": dict(metadata or {}),
            "ContentLength": len(body),
            "ETag": f'"{etag}"',
        }

    def head_object(self, Bucket: str, Key: str) -> dict:  # noqa: N803 - boto3 signature
        try:
            item = self.objects[(Bucket, Key)]
        except KeyError as exc:
            raise FakeNotFound() from exc
        return {
            "Metadata": item["Metadata"],
            "ContentLength": item["ContentLength"],
            "ETag": item["ETag"],
        }


class R2CheckpointReconcileTests(unittest.TestCase):
    def make_bundle(self, root: Path) -> Path:
        bundle = root / "bundle" / "r2"
        media = bundle / "media" / "mdl_a" / "img_a"
        gallery = bundle / "gallery" / "mdl_a"
        media.mkdir(parents=True)
        gallery.mkdir(parents=True)
        (media / "card.webp").write_bytes(b"card-v1")
        (media / "thumb.webp").write_bytes(b"thumb-v1")
        (gallery / "manifest.json").write_text('{"version":1}\n', encoding="utf-8")
        return bundle

    def seed_remote(self, client: FakeR2, bundle: Path) -> None:
        for path in bundle.rglob("*"):
            if path.is_file():
                client.put("bucket", path.relative_to(bundle).as_posix(), path.read_bytes())

    def test_apply_adopts_legacy_objects_using_etag_md5(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            bundle = self.make_bundle(root)
            state = root / "state.json"
            client = FakeR2()
            self.seed_remote(client, bundle)

            result = reconcile(bundle, state, "bucket", client, apply=True)

            self.assertEqual(result["verified"], 3)
            self.assertEqual(result["adopted"], 3)
            self.assertEqual(result["pending"], 0)
            saved = json.loads(state.read_text(encoding="utf-8"))
            self.assertEqual(len(saved["objects"]), 3)
            self.assertTrue(all(item["remote_verified"] for item in saved["objects"].values()))
            self.assertTrue(all(item["verified_via"] == "etag-md5" for item in saved["objects"].values()))

    def test_dry_run_does_not_write_checkpoint(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            bundle = self.make_bundle(root)
            state = root / "state.json"
            client = FakeR2()
            self.seed_remote(client, bundle)

            result = reconcile(bundle, state, "bucket", client, apply=False)

            self.assertEqual(result["adopted"], 3)
            self.assertFalse(state.exists())

    def test_missing_remote_object_stays_pending(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            bundle = self.make_bundle(root)
            state = root / "state.json"
            client = FakeR2()
            self.seed_remote(client, bundle)
            del client.objects[("bucket", "media/mdl_a/img_a/thumb.webp")]

            result = reconcile(bundle, state, "bucket", client, apply=True)

            self.assertEqual(result["verified"], 2)
            self.assertEqual(result["missing"], 1)
            self.assertEqual(result["pending"], 1)
            saved = json.loads(state.read_text(encoding="utf-8"))
            self.assertNotIn("media/mdl_a/img_a/thumb.webp", saved["objects"])

    def test_same_size_different_content_is_not_adopted(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            bundle = self.make_bundle(root)
            state = root / "state.json"
            client = FakeR2()
            self.seed_remote(client, bundle)
            client.put("bucket", "media/mdl_a/img_a/card.webp", b"xxxxxxx")

            result = reconcile(bundle, state, "bucket", client, apply=True)

            self.assertEqual(result["mismatched"], 1)
            self.assertEqual(result["pending"], 1)

    def test_sha256_metadata_is_accepted_without_etag_fallback(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            bundle = self.make_bundle(root)
            state = root / "state.json"
            client = FakeR2()
            self.seed_remote(client, bundle)
            card = bundle / "media" / "mdl_a" / "img_a" / "card.webp"
            sha = hashlib.sha256(card.read_bytes()).hexdigest()
            client.put("bucket", "media/mdl_a/img_a/card.webp", b"xxxxxxx", {"sha256": sha})

            result = reconcile(bundle, state, "bucket", client, apply=True)

            self.assertEqual(result["verified"], 3)
            saved = json.loads(state.read_text(encoding="utf-8"))
            self.assertEqual(saved["objects"]["media/mdl_a/img_a/card.webp"]["verified_via"], "sha256-metadata")


if __name__ == "__main__":
    unittest.main()
