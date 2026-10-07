from __future__ import annotations

import json
import sqlite3
import tempfile
import unittest
from pathlib import Path

from catalog_schema_contract import (
    load_schema_contract,
    schema_migrations_statement,
    schema_structure_statement,
    validate_applied_migrations,
    validate_schema_structures,
)


class CatalogSchemaContractTests(unittest.TestCase):
    def test_contract_loads_and_latest_matches_last_required_migration(self) -> None:
        contract = load_schema_contract()

        self.assertGreaterEqual(contract["version"], 1)
        self.assertGreater(len(contract["requiredMigrations"]), 0)
        self.assertEqual(contract["latestMigration"], contract["requiredMigrations"][-1])

    def test_contract_rejects_duplicate_or_stale_latest_migration(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "contract.json"
            path.write_text(json.dumps({
                "version": 1,
                "latestMigration": "0001.sql",
                "requiredMigrations": ["0001.sql", "0001.sql"],
            }), encoding="utf-8")
            with self.assertRaisesRegex(RuntimeError, "vazias/duplicadas"):
                load_schema_contract(path)

            path.write_text(json.dumps({
                "version": 1,
                "latestMigration": "0001.sql",
                "requiredMigrations": ["0001.sql", "0002.sql"],
            }), encoding="utf-8")
            with self.assertRaisesRegex(RuntimeError, "última migration"):
                load_schema_contract(path)

    def test_schema_statement_is_bounded_to_required_migrations(self) -> None:
        contract = {
            "version": 1,
            "latestMigration": "0002.sql",
            "requiredMigrations": ["0001.sql", "0002.sql"],
        }

        statement = schema_migrations_statement(contract)

        self.assertIn("FROM d1_migrations", statement["sql"])
        self.assertEqual(statement["params"], ["0001.sql", "0002.sql"])
        self.assertEqual(statement["sql"].count("?"), 2)

    def test_structure_statement_and_validation_share_contract_objects(self) -> None:
        contract = {
            "version": 1,
            "latestMigration": "0001.sql",
            "requiredMigrations": ["0001.sql"],
            "requiredObjects": {
                "tables": ["model_gallery_members"],
                "indexes": ["idx_gallery"],
                "triggers": ["trg_gallery"],
                "columns": {
                    "models": ["public_gallery_version"],
                },
            },
        }

        statement = schema_structure_statement(contract)

        self.assertIn("sqlite_schema", statement["sql"])
        self.assertIn("pragma_table_info('models')", statement["sql"])

        rows = [
            {"structure_key": "table:model_gallery_members"},
            {"structure_key": "index:idx_gallery"},
            {"structure_key": "trigger:trg_gallery"},
            {"structure_key": "column:models.public_gallery_version"},
        ]
        ready = validate_schema_structures(contract, rows)
        self.assertEqual(ready["requiredStructures"], 4)
        self.assertEqual(ready["verifiedStructures"], 4)

        with self.assertRaisesRegex(RuntimeError, "estrutura D1 diverge"):
            validate_schema_structures(contract, rows[:-1])

    def test_structure_statement_executes_against_real_sqlite_schema(self) -> None:
        db = sqlite3.connect(":memory:")
        db.executescript("""
        CREATE TABLE models(
          id TEXT PRIMARY KEY,
          public_gallery_version INTEGER NOT NULL DEFAULT 1
        );
        CREATE TABLE model_gallery_members(
          canonical_model_id TEXT NOT NULL,
          source_model_id TEXT NOT NULL
        );
        CREATE INDEX idx_gallery ON model_gallery_members(canonical_model_id);
        CREATE TRIGGER trg_gallery
        BEFORE INSERT ON model_gallery_members
        BEGIN
          SELECT CASE WHEN NEW.canonical_model_id=NEW.source_model_id
            THEN RAISE(ABORT, 'invalid') END;
        END;
        """)
        contract = {
            "version": 1,
            "latestMigration": "0001.sql",
            "requiredMigrations": ["0001.sql"],
            "requiredObjects": {
                "tables": ["model_gallery_members"],
                "indexes": ["idx_gallery"],
                "triggers": ["trg_gallery"],
                "columns": {"models": ["public_gallery_version"]},
            },
        }

        statement = schema_structure_statement(contract)
        rows = [
            {"structure_key": row[0]}
            for row in db.execute(statement["sql"], statement["params"]).fetchall()
        ]
        ready = validate_schema_structures(contract, rows)

        self.assertEqual(ready["verifiedStructures"], 4)
        db.close()

    def test_applied_migrations_fail_closed_when_any_required_item_is_missing(self) -> None:
        contract = {
            "version": 7,
            "latestMigration": "0003.sql",
            "requiredMigrations": ["0001.sql", "0002.sql", "0003.sql"],
        }

        with self.assertRaisesRegex(RuntimeError, "schema D1 ainda não está pronto"):
            validate_applied_migrations(
                contract,
                [{"name": "0001.sql"}, {"name": "0003.sql"}],
            )

        ready = validate_applied_migrations(
            contract,
            [{"name": "0003.sql"}, {"name": "0001.sql"}, {"name": "0002.sql"}],
        )
        self.assertTrue(ready["ready"])
        self.assertEqual(ready["contractVersion"], 7)
        self.assertEqual(ready["latestMigration"], "0003.sql")
        self.assertEqual(ready["appliedRequiredMigrations"], 3)


if __name__ == "__main__":
    unittest.main()
