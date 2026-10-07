from __future__ import annotations

import unittest
from unittest.mock import patch

from backfill_image_source_index import (
    apply_statement_batches,
    coverage_statement,
    missing_page_statement,
    source_statements,
    validate_manifest,
)


def model_row() -> dict:
    return {
        "id": "mdl-1",
        "slug": "modelo",
        "image_count": 2,
        "gallery_version": 7,
        "gallery_manifest_key": "gallery/mdl-1/manifest.json",
    }


def manifest() -> dict:
    return {
        "modelId": "mdl-1",
        "version": 7,
        "images": [
            {
                "id": "img-cover",
                "role": "cover",
                "sourceSha256": "a" * 64,
            },
            {
                "id": "img-side",
                "role": "gallery",
                "sourceSha256": "b" * 64,
            },
        ],
    }


class ImageSourceBackfillTests(unittest.TestCase):
    def test_manifest_validation_materializes_only_identity_metadata(self) -> None:
        rows = validate_manifest(model_row(), manifest())

        self.assertEqual(len(rows), 2)
        self.assertEqual(rows[0]["position"], 0)
        self.assertEqual(rows[0]["role"], "cover")
        self.assertEqual(rows[1]["source_sha256"], "b" * 64)
        self.assertNotIn("variantKeys", rows[0])

    def test_manifest_rejects_duplicate_sha_inside_same_gallery(self) -> None:
        payload = manifest()
        payload["images"][1]["sourceSha256"] = "a" * 64

        with self.assertRaisesRegex(RuntimeError, "SHA-256 duplicado"):
            validate_manifest(model_row(), payload)

    def test_missing_query_includes_attached_unpublished_sources(self) -> None:
        statement = missing_page_statement("mdl-100", 50)
        sql = statement["sql"]

        self.assertIn("m.published=1", sql)
        self.assertIn("member.source_model_id=m.id", sql)
        self.assertIn("canonical.published=1", sql)
        self.assertIn("s.gallery_version=m.gallery_version", sql)
        self.assertEqual(statement["params"], ["mdl-100", 50])

    def test_coverage_uses_same_effective_public_scope(self) -> None:
        sql = coverage_statement()["sql"]

        self.assertIn("model_gallery_members member", sql)
        self.assertIn("canonical.published=1", sql)
        self.assertIn("s.gallery_version=m.gallery_version", sql)

    def test_source_statements_upsert_current_version_and_only_delete_old_metadata(self) -> None:
        images = validate_manifest(model_row(), manifest())
        statements = source_statements(images)

        self.assertEqual(len(statements), 3)
        self.assertEqual(sum("INSERT INTO model_image_sources" in item["sql"] for item in statements), 2)
        self.assertEqual(
            statements[-1],
            {
                "sql": "DELETE FROM model_image_sources WHERE model_id=? AND gallery_version<>?",
                "params": ["mdl-1", 7],
            },
        )
        self.assertFalse(any("DELETE FROM models" in item["sql"] for item in statements))

    def test_d1_batches_are_bounded_and_retriable(self) -> None:
        statements = [{"sql": "SELECT 1", "params": []} for _ in range(205)]

        with patch("backfill_image_source_index.d1_request") as request:
            batches = apply_statement_batches(statements, batch_size=100)

        self.assertEqual(batches, 3)
        self.assertEqual([len(call.args[0]) for call in request.call_args_list], [100, 100, 5])

    def test_page_and_batch_limits_fail_closed(self) -> None:
        with self.assertRaises(ValueError):
            missing_page_statement("", 201)
        with self.assertRaises(ValueError):
            apply_statement_batches([], batch_size=251)


if __name__ == "__main__":
    unittest.main()
