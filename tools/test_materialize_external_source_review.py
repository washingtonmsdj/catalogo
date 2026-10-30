import unittest
import tempfile
from pathlib import Path
from unittest.mock import patch
from io import BytesIO

from materialize_external_source_review import safe_source_url, selected_review, selected_reviews, download


class ExternalSourceReviewTests(unittest.TestCase):
    def source_map(self):
        return {
            "missingSource": {
                "position": 1,
                "sourcePath": "/wp-content/uploads/a.webp",
                "sha256": "a" * 64,
                "bytes": 123,
            },
            "images": [
                {
                    "position": 1,
                    "sourcePath": "/wp-content/uploads/a.webp",
                    "sha256": "a" * 64,
                    "bytes": 123,
                    "stagingVerified": False,
                    "reviewState": "visual_review_required",
                }
            ],
        }

    def multi_source_map(self):
        return {
            "reviewSources": [
                {"position": 1, "sourcePath": "/wp-content/uploads/a.webp", "sha256": "a" * 64, "bytes": 123},
                {"position": 3, "sourcePath": "/wp-content/uploads/c.webp", "sha256": "c" * 64, "bytes": 456},
            ],
            "images": [
                {"position": 1, "sourcePath": "/wp-content/uploads/a.webp", "sha256": "a" * 64, "bytes": 123, "stagingVerified": False, "reviewState": "visual_review_required"},
                {"position": 2, "sourcePath": "/wp-content/uploads/b.webp", "sha256": "b" * 64, "bytes": 200, "stagingVerified": True, "watermarkStatus": "clear"},
                {"position": 3, "sourcePath": "/wp-content/uploads/c.webp", "sha256": "c" * 64, "bytes": 456, "stagingVerified": False, "reviewState": "visual_review_required"},
            ],
        }

    def test_selects_exact_missing_review_row(self):
        row = selected_review(self.source_map())
        self.assertEqual(row["sha256"], "a" * 64)

    def test_selects_multiple_explicit_review_rows(self):
        rows = selected_reviews(self.multi_source_map())
        self.assertEqual([row["position"] for row in rows], [1, 3])
        self.assertEqual([row["sha256"] for row in rows], ["a" * 64, "c" * 64])

    def test_single_accessor_rejects_multiple_reviews(self):
        with self.assertRaisesRegex(RuntimeError, "múltiplas"):
            selected_review(self.multi_source_map())

    def test_rejects_already_staged_source(self):
        data = self.source_map()
        data["images"][0]["stagingVerified"] = True
        with self.assertRaisesRegex(RuntimeError, "ausente do staging"):
            selected_review(data)

    def test_rejects_duplicate_review_position(self):
        data = self.multi_source_map()
        data["reviewSources"][1]["position"] = 1
        with self.assertRaisesRegex(RuntimeError, "position inválida/duplicada"):
            selected_reviews(data)

    def test_safe_source_url_preserves_authorized_origin(self):
        self.assertEqual(
            safe_source_url("https://example.com", "/wp-content/a.webp"),
            "https://example.com/wp-content/a.webp",
        )

    def test_rejects_traversal_and_query(self):
        with self.assertRaises(RuntimeError):
            safe_source_url("https://example.com", "/wp-content/../secret.webp")
        with self.assertRaises(RuntimeError):
            safe_source_url("https://example.com", "/wp-content/a.webp?x=1")

    def test_interrupted_transfer_retries_without_partial_file(self):
        class Broken(BytesIO):
            def read(self, size=-1):
                if self.tell():
                    raise ConnectionResetError("interrupted")
                return super().read(2)
            headers = {"Content-Type": "image/webp"}
        class Valid(BytesIO):
            headers = {"Content-Type": "image/webp"}
        with tempfile.TemporaryDirectory() as tmp:
            target = Path(tmp) / "cover.webp"
            with patch("materialize_external_source_review.urllib.request.urlopen",
                       side_effect=[Broken(b"badbytes"), Valid(b"complete")]) as opener:
                import hashlib
                sha, size, media_type = download("https://example.com/a.webp", target, 100)
            self.assertEqual(opener.call_count, 2)
            self.assertEqual(target.read_bytes(), b"complete")
            self.assertFalse((Path(tmp) / "cover.webp.partial").exists())
            self.assertEqual(sha, hashlib.sha256(b"complete").hexdigest())
            self.assertEqual((size, media_type), (8, "image/webp"))

    def test_oversize_is_not_retried_or_promoted(self):
        class Large(BytesIO):
            headers = {"Content-Type": "image/webp"}
        with tempfile.TemporaryDirectory() as tmp:
            target = Path(tmp) / "cover.webp"
            with patch("materialize_external_source_review.urllib.request.urlopen",
                       return_value=Large(b"too-large")) as opener:
                with self.assertRaisesRegex(RuntimeError, "limite"):
                    download("https://example.com/a.webp", target, 2)
            self.assertEqual(opener.call_count, 1)
            self.assertFalse(target.exists())
            self.assertFalse((Path(tmp) / "cover.webp.partial").exists())


if __name__ == "__main__":
    unittest.main()
