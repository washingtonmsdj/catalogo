from __future__ import annotations

import sqlite3
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
MIGRATIONS = ROOT / "migrations"


class CatalogSearchSchemaTests(unittest.TestCase):
    def setUp(self) -> None:
        self.db = sqlite3.connect(":memory:")
        for name in (
            "0001_catalog.sql",
            "0002_keyset_pagination.sql",
            "0003_catalog_counts.sql",
            "0004_search_fts.sql",
            "0005_franchise_discovery.sql",
        ):
            self.db.executescript((MIGRATIONS / name).read_text(encoding="utf-8"))

        self.db.execute("INSERT INTO categories(slug,name) VALUES('games','Games')")
        self.db.execute(
            "INSERT INTO franchises(category_id,slug,name) VALUES(1,'pokemon','Pokémon')"
        )

    def tearDown(self) -> None:
        self.db.close()

    def search(self, phrase: str) -> list[str]:
        escaped = phrase.replace('"', '""')
        rows = self.db.execute(
            "SELECT model_id FROM models_fts WHERE models_fts MATCH ? ORDER BY model_id",
            (f'"{escaped}"',),
        ).fetchall()
        return [row[0] for row in rows]

    def test_trigram_search_is_substring_and_diacritic_insensitive(self) -> None:
        self.db.execute(
            """INSERT INTO models(
              id,franchise_id,slug,code,name,published,search_text
            ) VALUES('mdl-1',1,'pikachu','TS-000001','Pikachu',1,?)""",
            ("pokémon pikachu elétrico",),
        )
        self.assertEqual(self.search("pokemon"), ["mdl-1"])
        self.assertEqual(self.search("kachu"), ["mdl-1"])
        self.assertEqual(self.search("eletrico"), ["mdl-1"])

    def test_fts_triggers_follow_update_and_delete(self) -> None:
        self.db.execute(
            """INSERT INTO models(
              id,franchise_id,slug,code,name,published,search_text
            ) VALUES('mdl-2',1,'jill','TS-000002','Jill',1,'resident evil jill')"""
        )
        self.assertEqual(self.search("resident"), ["mdl-2"])

        self.db.execute(
            "UPDATE models SET search_text='biohazard valentine' WHERE id='mdl-2'"
        )
        self.assertEqual(self.search("resident"), [])
        self.assertEqual(self.search("valentine"), ["mdl-2"])

        self.db.execute("DELETE FROM models WHERE id='mdl-2'")
        self.assertEqual(self.search("valentine"), [])

    def test_franchise_discovery_indexes_exist(self) -> None:
        names = {
            row[1]
            for row in self.db.execute("PRAGMA index_list('franchises')").fetchall()
        }
        self.assertIn("idx_franchises_category_discovery", names)
        self.assertIn("idx_franchises_global_discovery", names)


if __name__ == "__main__":
    unittest.main()
