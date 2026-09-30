from __future__ import annotations

import sqlite3
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
MIGRATIONS = ROOT / "migrations"


class QuoteSchemaTests(unittest.TestCase):
    def setUp(self) -> None:
        self.db = sqlite3.connect(":memory:")
        for name in (
            "0001_catalog.sql",
            "0002_keyset_pagination.sql",
            "0003_catalog_counts.sql",
            "0004_search_fts.sql",
            "0005_franchise_discovery.sql",
            "0006_franchise_search_fts.sql",
        ):
            self.db.executescript((MIGRATIONS / name).read_text(encoding="utf-8"))

    def tearDown(self) -> None:
        self.db.close()

    def test_quote_reference_migration_backfills_legacy_rows_and_enforces_uniqueness(self) -> None:
        legacy_id = "11111111-2222-3333-4444-555555555555"
        self.db.execute(
            "INSERT INTO quote_requests(id,name,email) VALUES(?,?,?)",
            (legacy_id, "Cliente antigo", "antigo@example.com"),
        )

        self.db.executescript(
            (MIGRATIONS / "0007_quote_public_reference.sql").read_text(encoding="utf-8")
        )

        reference = self.db.execute(
            "SELECT reference FROM quote_requests WHERE id=?", (legacy_id,)
        ).fetchone()[0]
        self.assertEqual(reference, f"LEGACY-{legacy_id}")

        self.db.execute(
            "INSERT INTO quote_requests(id,reference,name,email) VALUES(?,?,?,?)",
            (
                "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee",
                "TCS-AAAA-BBBB-CCCC-DDDD-EEEE",
                "Cliente novo",
                "novo@example.com",
            ),
        )

        with self.assertRaises(sqlite3.IntegrityError):
            self.db.execute(
                "INSERT INTO quote_requests(id,reference,name,email) VALUES(?,?,?,?)",
                (
                    "ffffffff-1111-2222-3333-444444444444",
                    "TCS-AAAA-BBBB-CCCC-DDDD-EEEE",
                    "Duplicado",
                    "duplicado@example.com",
                ),
            )


if __name__ == "__main__":
    unittest.main()
