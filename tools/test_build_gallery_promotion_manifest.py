import tempfile
import unittest
from pathlib import Path

from build_gallery_promotion_manifest import build_promotion_rows, write_csv


def incoming(path: str, sha: str) -> dict:
    return {
        "path": path,
        "sha256": sha,
        "dhash": "0000000000000000",
        "qualityScore": 90.0,
        "width": 1200,
        "height": 1800,
        "bytes": 123456,
    }


class GalleryPromotionManifestTests(unittest.TestCase):
    def test_builds_non_destructive_authorization_rows(self):
        resolution = {
            "version": 1,
            "ready": True,
            "promotions": [
                {
                    "model": "Games / Saga / Heroi / modelo-01",
                    "sourceModel": "fonte / produto-01",
                    "incoming": incoming("fonte/costas.jpg", "a" * 64),
                    "mode": "add_view",
                    "replaceSha256": None,
                },
                {
                    "model": "Games / Saga / Heroi / modelo-02",
                    "sourceModel": "fonte / produto-02",
                    "incoming": incoming("fonte/frente-hq.png", "b" * 64),
                    "mode": "replace_existing",
                    "replaceSha256": "c" * 64,
                },
            ],
        }

        rows, summary = build_promotion_rows(resolution)

        self.assertEqual(len(rows), 2)
        self.assertTrue(all(row["authorization_id"].startswith("promo_") for row in rows))
        self.assertEqual(summary["promotions"], 2)
        self.assertEqual(summary["addView"], 1)
        self.assertEqual(summary["replaceExisting"], 1)
        self.assertEqual(summary["sourceFilesModified"], 0)
        self.assertEqual(summary["destructiveDeletes"], 0)

    def test_rejects_resolution_that_is_not_ready(self):
        with self.assertRaisesRegex(RuntimeError, "não está pronta"):
            build_promotion_rows({"version": 1, "ready": False, "promotions": []})

    def test_replace_requires_valid_distinct_sha(self):
        resolution = {
            "version": 1,
            "ready": True,
            "promotions": [{
                "model": "modelo-01",
                "sourceModel": "produto-01",
                "incoming": incoming("fonte/frente.png", "a" * 64),
                "mode": "replace_existing",
                "replaceSha256": "a" * 64,
            }],
        }

        with self.assertRaisesRegex(RuntimeError, "igual ao source_sha256"):
            build_promotion_rows(resolution)

    def test_add_view_rejects_replace_sha(self):
        resolution = {
            "version": 1,
            "ready": True,
            "promotions": [{
                "model": "modelo-01",
                "sourceModel": "produto-01",
                "incoming": incoming("fonte/costas.png", "a" * 64),
                "mode": "add_view",
                "replaceSha256": "b" * 64,
            }],
        }

        with self.assertRaisesRegex(RuntimeError, "não aceita replace_sha256"):
            build_promotion_rows(resolution)

    def test_duplicate_image_authorization_fails_closed(self):
        promotion = {
            "model": "modelo-01",
            "sourceModel": "produto-01",
            "incoming": incoming("fonte/costas.png", "a" * 64),
            "mode": "add_view",
            "replaceSha256": None,
        }
        resolution = {"version": 1, "ready": True, "promotions": [promotion, dict(promotion)]}

        with self.assertRaisesRegex(RuntimeError, "múltiplas promoções"):
            build_promotion_rows(resolution)

    def test_csv_has_stable_columns_and_utf8_bom(self):
        resolution = {
            "version": 1,
            "ready": True,
            "promotions": [{
                "model": "Games / Saga / Herói / modelo-01",
                "sourceModel": "fonte / produto-01",
                "incoming": incoming("fonte/costas.jpg", "a" * 64),
                "mode": "add_view",
                "replaceSha256": None,
            }],
        }
        rows, _ = build_promotion_rows(resolution)

        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "promotions.csv"
            write_csv(path, rows)
            raw = path.read_bytes()
            self.assertTrue(raw.startswith(b"\xef\xbb\xbf"))
            text = raw.decode("utf-8-sig")
            self.assertIn("authorization_id,source_path,source_sha256,target_model,source_model,mode,replace_sha256", text)
            self.assertIn("Herói", text)


if __name__ == "__main__":
    unittest.main()
