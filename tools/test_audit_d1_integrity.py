from __future__ import annotations

import unittest
import sqlite3

from audit_d1_integrity import (
    integrity_queries,
    metric_queries,
    validate_integrity_results,
)


class AuditD1IntegrityTests(unittest.TestCase):
    def test_integrity_queries_are_named_unique_and_read_only(self) -> None:
        checks = integrity_queries()
        names = [str(item["name"]) for item in checks]

        self.assertEqual(len(names), len(set(names)))
        self.assertGreaterEqual(len(checks), 20)
        self.assertIn("folder_subtree_counts", names)
        self.assertIn("gallery_relation_state", names)
        self.assertIn("gallery_relation_chains", names)
        self.assertIn("image_source_version_drift", names)

        forbidden = (" INSERT ", " UPDATE ", " DELETE ", " REPLACE ", " DROP ", " ALTER ", " CREATE ")
        for query in [*checks, *metric_queries()]:
            sql = " " + " ".join(str(query["sql"]).upper().split()) + " "
            self.assertTrue(sql.lstrip().startswith(("SELECT ", "WITH ")))
            for token in forbidden:
                self.assertNotIn(token, sql)

    def test_zero_integrity_results_pass_and_metrics_are_preserved(self) -> None:
        checks = integrity_queries()
        metrics = metric_queries()
        results = [
            {"success": True, "results": [{"n": 0}]}
            for _ in checks
        ] + [
            {"success": True, "results": [{"value": index + 10}]}
            for index, _ in enumerate(metrics)
        ]

        summary = validate_integrity_results(checks, metrics, results)

        self.assertTrue(summary["ready"])
        self.assertEqual(summary["checks"], len(checks))
        self.assertEqual(summary["failures"], 0)
        self.assertEqual(summary["metrics"][metrics[0]["name"]], 10)

    def test_any_nonzero_integrity_check_fails_closed(self) -> None:
        checks = integrity_queries()
        metrics = metric_queries()
        results = [
            {"success": True, "results": [{"n": 0}]}
            for _ in checks
        ] + [
            {"success": True, "results": [{"value": 1}]}
            for _ in metrics
        ]
        target = next(
            index
            for index, item in enumerate(checks)
            if item["name"] == "model_folder_franchise"
        )
        results[target] = {"success": True, "results": [{"n": 2}]}

        with self.assertRaisesRegex(RuntimeError, "model_folder_franchise=2"):
            validate_integrity_results(checks, metrics, results)

    def test_gallery_approval_must_match_exact_relation_and_not_mask_bad_state(self) -> None:
        db = sqlite3.connect(":memory:")
        try:
            db.executescript("""
                CREATE TABLE models(
                    id TEXT PRIMARY KEY,published INTEGER,franchise_id INTEGER,
                    folder_id INTEGER,name TEXT
                );
                CREATE TABLE model_gallery_members(canonical_model_id TEXT,source_model_id TEXT);
                CREATE TABLE model_gallery_member_approvals(canonical_model_id TEXT,source_model_id TEXT);
                INSERT INTO models VALUES('can',1,7,9,'diorama frontal');
                INSERT INTO models VALUES('src',0,7,9,'diorama lateral');
                INSERT INTO model_gallery_members VALUES('can','src');
            """)
            sql = next(item["sql"] for item in integrity_queries()
                       if item["name"] == "gallery_relation_state")
            self.assertEqual(db.execute(sql).fetchone()[0], 1)
            db.execute("INSERT INTO model_gallery_member_approvals VALUES('can','wrong')")
            self.assertEqual(db.execute(sql).fetchone()[0], 1)
            db.execute("INSERT INTO model_gallery_member_approvals VALUES('can','src')")
            self.assertEqual(db.execute(sql).fetchone()[0], 0)
            db.execute("UPDATE models SET published=1 WHERE id='src'")
            self.assertEqual(db.execute(sql).fetchone()[0], 1)
        finally:
            db.close()

    def test_result_cardinality_and_shape_fail_closed(self) -> None:
        checks = integrity_queries()
        metrics = metric_queries()

        with self.assertRaisesRegex(RuntimeError, "esperado"):
            validate_integrity_results(checks, metrics, [])

        results = [
            {"success": True, "results": [{"n": 0}]}
            for _ in checks
        ] + [
            {"success": True, "results": [{"value": 1}]}
            for _ in metrics
        ]
        results[0] = {"success": True, "results": []}

        with self.assertRaisesRegex(RuntimeError, "formato inválido"):
            validate_integrity_results(checks, metrics, results)


if __name__ == "__main__":
    unittest.main()
