from __future__ import annotations

import sqlite3
import unittest
from pathlib import Path


class CatalogFoldersSchemaTests(unittest.TestCase):
    def setUp(self) -> None:
        self.db = sqlite3.connect(":memory:")
        migrations = Path(__file__).resolve().parents[1] / "migrations"
        for name in ("0001_catalog.sql", "0002_keyset_pagination.sql", "0003_catalog_counts.sql", "0009_catalog_folders.sql"):
            self.db.executescript((migrations / name).read_text(encoding="utf-8"))
        self.db.execute("INSERT INTO categories(slug,name) VALUES('animes-desenhos','Animes & Desenhos')")
        category_id = self.db.execute("SELECT id FROM categories WHERE slug='animes-desenhos'").fetchone()[0]
        self.db.execute(
            "INSERT INTO franchises(category_id,slug,name) VALUES(?,?,?)",
            (category_id, "as-tartarugas-ninja", "As Tartarugas Ninja"),
        )
        self.franchise_id = self.db.execute(
            "SELECT id FROM franchises WHERE slug='as-tartarugas-ninja'"
        ).fetchone()[0]

    def tearDown(self) -> None:
        self.db.close()

    def test_nested_folders_and_model_assignment(self) -> None:
        self.db.execute(
            "INSERT INTO catalog_folders(franchise_id,slug,name,path,depth) VALUES(?,?,?,?,?)",
            (self.franchise_id, "viloes", "Vilões", "viloes", 1),
        )
        villains_id = self.db.execute(
            "SELECT id FROM catalog_folders WHERE path='viloes'"
        ).fetchone()[0]
        self.db.execute(
            "INSERT INTO catalog_folders(franchise_id,parent_id,slug,name,path,depth) VALUES(?,?,?,?,?,?)",
            (self.franchise_id, villains_id, "destruidor", "Destruidor", "viloes/destruidor", 2),
        )
        shredder_id = self.db.execute(
            "SELECT id FROM catalog_folders WHERE path='viloes/destruidor'"
        ).fetchone()[0]
        self.db.execute(
            "INSERT INTO models(id,franchise_id,folder_id,slug,code,name,published) VALUES(?,?,?,?,?,?,1)",
            ("mdl-1", self.franchise_id, shredder_id, "destruidor-01", "TS-1", "Destruidor 01"),
        )

        row = self.db.execute(
            "SELECT cf.path,m.name FROM models m JOIN catalog_folders cf ON cf.id=m.folder_id"
        ).fetchone()
        self.assertEqual(row, ("viloes/destruidor", "Destruidor 01"))

    def test_parent_folder_count_includes_descendants(self) -> None:
        self.db.execute(
            "INSERT INTO catalog_folders(franchise_id,slug,name,path,depth) VALUES(?,?,?,?,?)",
            (self.franchise_id, "viloes", "Vilões", "viloes", 1),
        )
        villains_id = self.db.execute("SELECT id FROM catalog_folders WHERE path='viloes'").fetchone()[0]
        for slug, name in (("destruidor", "Destruidor"), ("bebop", "Bebop")):
            self.db.execute(
                "INSERT INTO catalog_folders(franchise_id,parent_id,slug,name,path,depth) VALUES(?,?,?,?,?,2)",
                (self.franchise_id, villains_id, slug, name, f"viloes/{slug}"),
            )
            folder_id = self.db.execute(
                "SELECT id FROM catalog_folders WHERE path=?", (f"viloes/{slug}",)
            ).fetchone()[0]
            self.db.execute(
                "INSERT INTO models(id,franchise_id,folder_id,slug,code,name,published) VALUES(?,?,?,?,?,?,1)",
                (f"mdl-{slug}", self.franchise_id, folder_id, slug, f"TS-{slug}", name),
            )

        count = self.db.execute(
            """WITH RECURSIVE scope(id) AS (
              SELECT id FROM catalog_folders WHERE franchise_id=? AND path='viloes'
              UNION ALL
              SELECT child.id FROM catalog_folders child JOIN scope ON child.parent_id=scope.id
            )
            SELECT COUNT(*) FROM models WHERE published=1 AND folder_id IN (SELECT id FROM scope)""",
            (self.franchise_id,),
        ).fetchone()[0]
        self.assertEqual(count, 2)

    def test_tmnt_root_keeps_hero_and_groups_villain_subtree(self) -> None:
        self.db.execute(
            "INSERT INTO catalog_folders(franchise_id,slug,name,path,depth) VALUES(?,?,?,?,?)",
            (self.franchise_id, "leonardo", "Leonardo", "leonardo", 1),
        )
        self.db.execute(
            "INSERT INTO catalog_folders(franchise_id,slug,name,path,depth) VALUES(?,?,?,?,?)",
            (self.franchise_id, "viloes", "Vilões", "viloes", 1),
        )
        villains_id = self.db.execute("SELECT id FROM catalog_folders WHERE path='viloes'").fetchone()[0]
        self.db.execute(
            "INSERT INTO catalog_folders(franchise_id,parent_id,slug,name,path,depth) VALUES(?,?,?,?,?,2)",
            (self.franchise_id, villains_id, "destruidor", "Destruidor", "viloes/destruidor"),
        )

        root = self.db.execute(
            "SELECT name,path FROM catalog_folders WHERE franchise_id=? AND parent_id IS NULL ORDER BY name",
            (self.franchise_id,),
        ).fetchall()
        children = self.db.execute(
            "SELECT name,path FROM catalog_folders WHERE franchise_id=? AND parent_id=? ORDER BY name",
            (self.franchise_id, villains_id),
        ).fetchall()

        self.assertEqual(root, [("Leonardo", "leonardo"), ("Vilões", "viloes")])
        self.assertEqual(children, [("Destruidor", "viloes/destruidor")])

    def test_folder_lookup_is_scoped_to_category_and_franchise(self) -> None:
        self.db.execute(
            "INSERT INTO catalog_folders(franchise_id,slug,name,path,depth) VALUES(?,?,?,?,?)",
            (self.franchise_id, "viloes", "Vilões", "viloes", 1),
        )
        category_id = self.db.execute("SELECT id FROM categories WHERE slug='animes-desenhos'").fetchone()[0]
        self.db.execute(
            "INSERT INTO franchises(category_id,slug,name) VALUES(?,?,?)",
            (category_id, "outra-franquia", "Outra Franquia"),
        )
        other_id = self.db.execute("SELECT id FROM franchises WHERE slug='outra-franquia'").fetchone()[0]
        self.db.execute(
            "INSERT INTO catalog_folders(franchise_id,slug,name,path,depth) VALUES(?,?,?,?,?)",
            (other_id, "viloes", "Vilões", "viloes", 1),
        )

        def exists(franchise_slug: str, path: str) -> bool:
            row = self.db.execute(
                """SELECT 1 FROM catalog_folders cf
                JOIN franchises f ON f.id=cf.franchise_id
                JOIN categories c ON c.id=f.category_id
                WHERE c.slug=? AND f.slug=? AND cf.path=? LIMIT 1""",
                ("animes-desenhos", franchise_slug, path),
            ).fetchone()
            return row is not None

        self.assertTrue(exists("as-tartarugas-ninja", "viloes"))
        self.assertTrue(exists("outra-franquia", "viloes"))
        self.assertFalse(exists("as-tartarugas-ninja", "herois"))
        self.assertFalse(exists("franquia-inexistente", "viloes"))

    def test_folder_path_is_unique_per_franchise(self) -> None:
        self.db.execute(
            "INSERT INTO catalog_folders(franchise_id,slug,name,path,depth) VALUES(?,?,?,?,?)",
            (self.franchise_id, "leonardo", "Leonardo", "leonardo", 1),
        )
        with self.assertRaises(sqlite3.IntegrityError):
            self.db.execute(
                "INSERT INTO catalog_folders(franchise_id,slug,name,path,depth) VALUES(?,?,?,?,?)",
                (self.franchise_id, "leonardo-2", "Leonardo duplicado", "leonardo", 1),
            )


if __name__ == "__main__":
    unittest.main()
