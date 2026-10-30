import sqlite3
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

    def test_sha_keyset_uses_existing_index_without_losing_entries(self):
        selected = []
        def record(_endpoint, _token, sql, _params):
            if sql.startswith("SELECT s.source_sha256"):
                selected.append(sql)
                return []
            return [{"published_models": 1, "indexed_models": 0, "indexed_images": 0}]
        with patch("audit_published_sha_inventory.query_rows", side_effect=record):
            inventory("account", "token", "db", 1)
        self.assertEqual(len(selected), 1)
        sql = selected[0]
        self.assertIn("(s.source_sha256,s.model_id)>(?,?)", sql)

        db = sqlite3.connect(":memory:")
        try:
            db.executescript("""
                CREATE TABLE models(id TEXT PRIMARY KEY,published INTEGER,gallery_version INTEGER);
                CREATE TABLE model_image_sources(model_id TEXT,source_sha256 TEXT,gallery_version INTEGER);
                CREATE INDEX idx_model_image_sources_sha
                    ON model_image_sources(source_sha256,model_id,gallery_version);
            """)
            db.executemany("INSERT INTO models VALUES(?,?,?)", [
                (f"mdl_{i:020x}", int(i % 11 != 0), 1) for i in range(1, 751)
            ])
            db.executemany("INSERT INTO model_image_sources VALUES(?,?,?)", [
                (f"mdl_{(i % 750)+1:020x}", f"{i // 3:064x}",
                 2 if i % 37 == 0 else 1) for i in range(1, 1701)
            ])
            plan = [row[3] for row in db.execute(
                "EXPLAIN QUERY PLAN " + sql, ("", "", 400)
            )]
            self.assertTrue(any(
                "SEARCH s USING COVERING INDEX idx_model_image_sources_sha" in row
                for row in plan
            ), plan)
            self.assertFalse(any("SCAN s" in row for row in plan), plan)
            cursor, actual = ("", ""), []
            for _ in range(10):
                page = db.execute(sql, (*cursor, 400)).fetchall()
                if not page:
                    break
                self.assertGreater(page[0], cursor)
                actual.extend(page)
                cursor = page[-1]
                if len(page) < 400:
                    break
            else:
                self.fail("SHA pagination did not converge")
            expected = db.execute("""
                SELECT s.source_sha256,s.model_id FROM model_image_sources s
                JOIN models m ON m.id=s.model_id
                WHERE m.published=1 AND s.gallery_version=m.gallery_version
                ORDER BY s.source_sha256,s.model_id
            """).fetchall()
            self.assertGreater(len(actual), 1000)
            self.assertEqual(actual, expected)
        finally:
            db.close()

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
