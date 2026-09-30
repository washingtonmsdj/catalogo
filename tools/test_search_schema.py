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
            "0006_franchise_search_fts.sql",
        ):
            self.db.executescript((MIGRATIONS / name).read_text(encoding="utf-8"))

        self.db.execute("INSERT INTO categories(slug,name) VALUES('games','Games')")
        self.db.execute("INSERT INTO categories(slug,name) VALUES('animes','Animes')")
        self.db.execute(
            "INSERT INTO franchises(category_id,slug,name) VALUES(1,'pokemon','Pokémon')"
        )
        self.db.execute(
            "INSERT INTO franchises(category_id,slug,name) VALUES(1,'resident-evil','Resident Evil')"
        )
        self.db.execute(
            "INSERT INTO franchises(category_id,slug,name) VALUES(2,'dragon-ball','Dragon Ball')"
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

    def search_franchises(self, phrase: str, category: str | None = None) -> list[str]:
        escaped = phrase.replace('"', '""')
        where = ["franchises_fts MATCH ?"]
        values: list[object] = [f'"{escaped}"']
        if category:
            where.append("c.slug=?")
            values.append(category)
        rows = self.db.execute(
            f"""SELECT f.slug
            FROM franchises f
            JOIN categories c ON c.id=f.category_id
            JOIN franchises_fts ON franchises_fts.franchise_id=f.id
            WHERE {' AND '.join(where)}
            ORDER BY f.model_count DESC,f.name COLLATE NOCASE,f.id""",
            values,
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
            ) VALUES('mdl-2',2,'jill','TS-000002','Jill',1,'resident evil jill')"""
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

    def test_franchise_browser_search_is_partial_and_diacritic_insensitive(self) -> None:
        self.assertEqual(self.search_franchises("resi"), ["resident-evil"])
        self.assertEqual(self.search_franchises("dragon"), ["dragon-ball"])
        self.assertEqual(self.search_franchises("pokemon"), ["pokemon"])
        self.assertEqual(self.search_franchises("evil", "games"), ["resident-evil"])
        self.assertEqual(self.search_franchises("evil", "animes"), [])
        self.assertEqual(self.search_franchises("dent-e"), ["resident-evil"])

    def test_franchise_fts_triggers_follow_update_and_delete(self) -> None:
        self.db.execute("UPDATE franchises SET name='Biohazard',slug='biohazard' WHERE slug='resident-evil'")
        self.assertEqual(self.search_franchises("resident"), [])
        self.assertEqual(self.search_franchises("bioha"), ["biohazard"])

        self.db.execute("DELETE FROM franchises WHERE slug='dragon-ball'")
        self.assertEqual(self.search_franchises("dragon"), [])


if __name__ == "__main__":
    unittest.main()
