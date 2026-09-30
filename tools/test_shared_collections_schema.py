from __future__ import annotations

import sqlite3
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
MIGRATIONS = ROOT / "migrations"


class SharedCollectionsSchemaTests(unittest.TestCase):
    def setUp(self) -> None:
        self.db = sqlite3.connect(":memory:")
        self.db.execute("PRAGMA foreign_keys = ON")
        self.db.executescript((MIGRATIONS / "0001_catalog.sql").read_text(encoding="utf-8"))
        self.db.executescript((MIGRATIONS / "0008_shared_collections.sql").read_text(encoding="utf-8"))
        self.db.execute("INSERT INTO categories(slug,name) VALUES('games','Games')")
        category_id = self.db.execute("SELECT id FROM categories WHERE slug='games'").fetchone()[0]
        self.db.execute("INSERT INTO franchises(category_id,slug,name) VALUES(?,?,?)", (category_id, 'resident-evil', 'Resident Evil'))
        franchise_id = self.db.execute("SELECT id FROM franchises WHERE slug='resident-evil'").fetchone()[0]
        self.db.execute(
            "INSERT INTO models(id,franchise_id,slug,code,name,published) VALUES(?,?,?,?,?,1)",
            ("mdl-1", franchise_id, "leon", "RE-001", "Leon",),
        )

    def tearDown(self) -> None:
        self.db.close()

    def test_shared_collection_preserves_order_and_cascades_items(self) -> None:
        self.db.execute(
            "INSERT INTO shared_collections(code,fingerprint,name,item_count,created_at,expires_at) VALUES(?,?,?,?,?,?)",
            ("TCL-abc", "fp-1", "Favoritos", 1, 100, 200),
        )
        self.db.execute(
            "INSERT INTO shared_collection_items(collection_code,model_id,position) VALUES(?,?,?)",
            ("TCL-abc", "mdl-1", 0),
        )
        row = self.db.execute(
            "SELECT model_id,position FROM shared_collection_items WHERE collection_code=?",
            ("TCL-abc",),
        ).fetchone()
        self.assertEqual(row, ("mdl-1", 0))
        self.db.execute("DELETE FROM shared_collections WHERE code=?", ("TCL-abc",))
        self.assertEqual(self.db.execute("SELECT COUNT(*) FROM shared_collection_items").fetchone()[0], 0)

    def test_shared_collection_constraints_reject_invalid_rows(self) -> None:
        with self.assertRaises(sqlite3.IntegrityError):
            self.db.execute(
                "INSERT INTO shared_collections(code,fingerprint,name,item_count,created_at,expires_at) VALUES(?,?,?,?,?,?)",
                ("TCL-empty", "fp-empty", "", 1, 100, 200),
            )
        with self.assertRaises(sqlite3.IntegrityError):
            self.db.execute(
                "INSERT INTO shared_collections(code,fingerprint,name,item_count,created_at,expires_at) VALUES(?,?,?,?,?,?)",
                ("TCL-expired", "fp-expired", "Teste", 1, 200, 100),
            )


if __name__ == "__main__":
    unittest.main()
