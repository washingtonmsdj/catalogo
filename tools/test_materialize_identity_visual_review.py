from __future__ import annotations

import io
import json
import unittest
import urllib.error

from materialize_identity_visual_review import (
    normalize_api_base,
    production_candidate,
    public_media_url,
    source_rows,
    verify_public_candidate,
)


SHA_A = "a" * 64
SHA_B = "b" * 64


class IdentityVisualReviewTests(unittest.TestCase):
    def test_source_rows_require_contiguous_unique_verified_metadata(self) -> None:
        rows = source_rows({"sourceImages": [
            {"position": 2, "sourcePath": "/b.jpg", "sha256": SHA_B, "bytes": 20},
            {"position": 1, "sourcePath": "/a.jpg", "sha256": SHA_A, "bytes": 10},
        ]})
        self.assertEqual([row["position"] for row in rows], [1, 2])

    def test_source_rows_reject_duplicate_sha(self) -> None:
        with self.assertRaises(RuntimeError):
            source_rows({"sourceImages": [
                {"position": 1, "sourcePath": "/a.jpg", "sha256": SHA_A, "bytes": 10},
                {"position": 2, "sourcePath": "/b.jpg", "sha256": SHA_A, "bytes": 20},
            ]})

    def test_candidate_requires_canonical_model_and_media_key(self) -> None:
        row = production_candidate({"productionCandidate": {
            "modelId": "mdl_abc",
            "slug": "big-boss",
            "name": "Big Boss",
            "franchise": "Metal Gear",
            "coverStorageKey": "media/mdl_abc/img_x/card.webp",
            "sourceSha256": SHA_A,
        }})
        self.assertEqual(row["modelId"], "mdl_abc")
        self.assertEqual(row["sourceSha256"], SHA_A)

    def test_public_media_url_encodes_reserved_characters_but_keeps_path(self) -> None:
        url = public_media_url(
            "https://catalog.example.test/",
            "media/mdl_abc/image name/card.webp",
        )
        self.assertEqual(url, "https://catalog.example.test/media/media/mdl_abc/image%20name/card.webp")

    def test_published_candidate_preflight_requires_exact_identity_and_cover(self) -> None:
        candidate = {
            "modelId": "mdl_abc",
            "slug": "big-boss",
            "coverStorageKey": "media/mdl_abc/cover.webp",
        }
        current = {
            "id": "mdl_abc",
            "slug": "big-boss",
            "cover_storage_key": "media/mdl_abc/cover.webp",
        }
        seen = []
        def opener(request, timeout):
            seen.append((request.full_url, timeout))
            return io.BytesIO(json.dumps(current).encode("utf-8"))
        self.assertEqual(
            verify_public_candidate("https://catalog.example.test", candidate, opener),
            current,
        )
        self.assertEqual(
            seen, [("https://catalog.example.test/api/models/big-boss", 20)]
        )

    def test_published_candidate_drift_fails_closed_without_fallback(self) -> None:
        candidate = {
            "modelId": "mdl_abc",
            "slug": "big-boss",
            "coverStorageKey": "media/mdl_abc/old.webp",
        }
        for current in (
            {"id": "mdl_other", "slug": "big-boss", "cover_storage_key": "media/mdl_abc/old.webp"},
            {"id": "mdl_abc", "slug": "big-boss", "cover_storage_key": "media/mdl_abc/new.webp"},
            {"id": "mdl_abc", "slug": "elsewhere", "cover_storage_key": "media/mdl_abc/old.webp"},
        ):
            with self.subTest(current=current):
                def opener(_request, timeout):
                    return io.BytesIO(json.dumps(current).encode("utf-8"))
                with self.assertRaisesRegex(RuntimeError, "evidence is stale"):
                    verify_public_candidate("https://catalog.example.test", candidate, opener)

    def test_unpublished_candidate_is_a_hard_block(self) -> None:
        candidate = {
            "modelId": "mdl_abc",
            "slug": "big-boss",
            "coverStorageKey": "media/mdl_abc/cover.webp",
        }
        def opener(_request, timeout):
            raise urllib.error.HTTPError("https://catalog.example.test", 404, "Not Found", {}, None)
        with self.assertRaisesRegex(RuntimeError, "candidate model unavailable: HTTP 404"):
            verify_public_candidate("https://catalog.example.test", candidate, opener)

    def test_api_base_is_https_origin_only(self) -> None:
        self.assertEqual(normalize_api_base("https://catalog.example.test/"), "https://catalog.example.test")
        for invalid in ("http://catalog.example.test", "https://catalog.example.test/x?y=1", "catalog.example.test"):
            with self.assertRaises(RuntimeError):
                normalize_api_base(invalid)


if __name__ == "__main__":
    unittest.main()
