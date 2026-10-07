from __future__ import annotations

import json
import tempfile
import unittest
from pathlib import Path

from catalog_schema_contract import (
    load_schema_contract,
    schema_migrations_statement,
    validate_applied_migrations,
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
