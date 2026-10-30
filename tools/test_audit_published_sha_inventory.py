import unittest
from unittest.mock import patch

from audit_external_source_coverage import CoverageError
from audit_published_sha_inventory import inventory


class PublishedShaInventoryTests(unittest.TestCase):
    def test_inventory_is_read_only_and_reports_coverage(self):
        m1, m2 = "mdl_" + "1" * 20, "mdl_" + "2" * 20
        def respond(_endpoint, _token, sql, _params):
            if sql.startswith("SELECT s.source_sha256"):
                return [{"sha": "a" * 64, "model_id": m1},
                        {"sha": "b" * 64, "model_id": m2}]
            return [{"published_models": 3, "indexed_models": 2, "indexed_images": 2}]
        with patch("audit_published_sha_inventory.query_rows", side_effect=respond) as call:
            result = inventory("account", "token", "db", 3)
        self.assertEqual(result["summary"]["modelsWithoutIndex"], 1)
        self.assertEqual(len(result["modelShaPairs"]), 2)
        self.assertFalse(result["missingShaProvesMissingSculpture"])
        self.assertFalse(result["identityApproved"])
        self.assertEqual(result["productionWrites"], 0)
        self.assertEqual(call.call_count, 2)
        self.assertIn("m.published=1", call.call_args_list[0].args[2])
        self.assertIn("s.gallery_version=m.gallery_version", call.call_args_list[0].args[2])

    def test_invalid_rows_and_drifting_counts_fail_closed(self):
        mid = "mdl_" + "f" * 20
        scenarios = [
            [{"sha": "invalid", "model_id": mid}],
            [{"sha": "b" * 64, "model_id": mid}, {"sha": "a" * 64, "model_id": mid}],
            [{"sha": "a" * 64, "model_id": "mdl_wrong"}],
        ]
        for rows in scenarios:
            with self.subTest(rows=rows), patch("audit_published_sha_inventory.query_rows",
                 return_value=rows):
                with self.assertRaises(CoverageError):
                    inventory("account", "token", "db", 1)
        with patch("audit_published_sha_inventory.query_rows",
                   side_effect=[[{"sha": "a" * 64, "model_id": mid}],
                                [{"published_models": 2, "indexed_models": 2, "indexed_images": 2}]]):
            with self.assertRaisesRegex(CoverageError, "changed during read"):
                inventory("account", "token", "db", 1)

    def test_empty_index_is_not_false_full_coverage(self):
        with patch("audit_published_sha_inventory.query_rows", side_effect=[
            [], [{"published_models": 2, "indexed_models": 0, "indexed_images": 0}],
        ]):
            result = inventory("account", "token", "db", 2)
        self.assertEqual(result["summary"]["modelsWithoutIndex"], 2)
        self.assertFalse(result["summary"]["allPublishedModelsIndexed"])


if __name__ == "__main__":
    unittest.main()
