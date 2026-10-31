from __future__ import annotations

import unittest
import sqlite3
from unittest.mock import patch

from audit_d1_integrity import (
    probe_schema_readability,
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

    def test_fts_missing_checks_use_set_difference_and_preserve_results(self) -> None:
        checks = {item["name"]: item["sql"] for item in integrity_queries()}
        cases = (
            ("models", "models_fts", "model_id", 420),
            ("franchises", "franchises_fts", "franchise_id", 130),
        )
        for base, fts, fts_id, count in cases:
            with self.subTest(table=base):
                db = sqlite3.connect(":memory:")
                try:
                    db.execute(f"CREATE TABLE {base}(id TEXT PRIMARY KEY)")
                    db.execute(
                        f"CREATE VIRTUAL TABLE {fts} USING fts5("
                        f"{fts_id} UNINDEXED,search_text)"
                    )
                    ids = [f"id_{i:05d}" for i in range(count)]
                    db.executemany(
                        f"INSERT INTO {base}(id) VALUES(?)",
                        [(identifier,) for identifier in ids],
                    )
                    db.executemany(
                        f"INSERT INTO {fts}({fts_id},search_text) VALUES(?,?)",
                        [(identifier, "sculpture") for identifier in ids],
                    )
                    sql = checks[f"{base}_fts_missing"]
                    prior = (
                        f"SELECT COUNT(*) FROM {base} m WHERE NOT EXISTS "
                        f"(SELECT 1 FROM {fts} f WHERE f.{fts_id}=m.id)"
                    )
                    plan = [row[3] for row in db.execute("EXPLAIN QUERY PLAN " + sql)]
                    self.assertTrue(any("EXCEPT" in step for step in plan), plan)
                    self.assertFalse(
                        any("CORRELATED" in step for step in plan), plan
                    )
                    self.assertEqual(db.execute(sql).fetchone(), (0,))
                    db.execute(
                        f"DELETE FROM {fts} WHERE {fts_id}=?", (ids[11],)
                    )
                    db.execute(
                        f"INSERT INTO {fts}({fts_id},search_text) VALUES(?,?)",
                        ("orphan-id", "sculpture"),
                    )
                    db.execute(
                        f"INSERT INTO {fts}({fts_id},search_text) VALUES(?,?)",
                        (None, "sculpture"),
                    )
                    self.assertEqual(db.execute(sql).fetchone(), (1,))
                    self.assertEqual(
                        db.execute(sql).fetchone(),
                        db.execute(prior).fetchone(),
                    )
                finally:
                    db.close()

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

    def test_preflight_reuses_exact_schema_queries_and_allows_pending_migration(self) -> None:
        with patch("audit_d1_integrity._query") as query:
            query.return_value = [
                {"success": True, "results": [{"name": "0001_catalog.sql"}]},
                {"success": True, "results": [{"structure_key": "table:models"}]},
            ]
            result = probe_schema_readability("account", "database", "token")
        self.assertEqual(result["schemaReadable"], True)
        self.assertEqual(result["observedMigrations"], 1)
        self.assertEqual(result["observedStructures"], 1)
        statements = query.call_args.args[3]
        self.assertEqual(len(statements), 2)
        self.assertIn("FROM d1_migrations", statements[0]["sql"])
        self.assertIn("WITH requirements(", statements[1]["sql"])
        self.assertIn("sqlite_schema", statements[1]["sql"])

    def test_preflight_fails_closed_on_schema_query_error_or_missing_baseline(self) -> None:
        cases = [
            ([{"success": True, "results": [{"name": "0001_catalog.sql"}]},
              {"success": False, "errors": [{"code": 7500}]}],
             "d1_preflight_schema_query_failed"),
            ([{"success": True, "results": []}, {"success": True, "results": [{}]}],
             "d1_schema_baseline_not_confirmed"),
            ([{"success": True, "results": [{"name": "0001_catalog.sql"}]},
              {"success": True, "results": []}],
             "d1_schema_structure_unreadable"),
        ]
        for response, error in cases:
            with self.subTest(error=error), patch("audit_d1_integrity._query", return_value=response):
                with self.assertRaisesRegex(RuntimeError, error):
                    probe_schema_readability("account", "database", "token")


if __name__ == "__main__":
    unittest.main()
