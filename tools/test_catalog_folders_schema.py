from __future__ import annotations

import sqlite3
import unittest
from pathlib import Path


class CatalogFoldersSchemaTests(unittest.TestCase):
    def setUp(self) -> None:
        self.db = sqlite3.connect(":memory:")
        migrations = Path(__file__).resolve().parents[1] / "migrations"
        for name in ("0001_catalog.sql", "0002_keyset_pagination.sql", "0003_catalog_counts.sql", "0009_catalog_folders.sql", "0010_recent_models_index.sql", "0011_model_gallery_members.sql", "0012_folder_materialized_counts.sql", "0013_model_image_sources.sql", "0014_gallery_member_integrity.sql", "0015_gallery_publication_invariant.sql"):
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

    def _insert_gallery_model(self, model_id: str, folder_id: int, slug: str, code: str, name: str) -> None:
        self.db.execute(
            """INSERT INTO models(
            id,franchise_id,folder_id,slug,code,name,image_count,cover_storage_key,
            gallery_manifest_key,gallery_version,published)
            VALUES(?,?,?,?,?,?,1,?,?,1,1)""",
            (
                model_id,
                self.franchise_id,
                folder_id,
                slug,
                code,
                name,
                f"media/{model_id}/card.webp",
                f"gallery/{model_id}/manifest.json",
            ),
        )

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

    def test_materialized_folder_counts_follow_model_lifecycle(self) -> None:
        self.db.execute(
            "INSERT INTO catalog_folders(franchise_id,slug,name,path,depth) VALUES(?,?,?,?,?)",
            (self.franchise_id, "viloes", "Vilões", "viloes", 1),
        )
        root_id = self.db.execute("SELECT id FROM catalog_folders WHERE path='viloes'").fetchone()[0]
        self.db.execute(
            "INSERT INTO catalog_folders(franchise_id,parent_id,slug,name,path,depth) VALUES(?,?,?,?,?,2)",
            (self.franchise_id, root_id, "destruidor", "Destruidor", "viloes/destruidor"),
        )
        leaf_id = self.db.execute(
            "SELECT id FROM catalog_folders WHERE path='viloes/destruidor'"
        ).fetchone()[0]

        self.db.execute(
            "INSERT INTO models(id,franchise_id,folder_id,slug,code,name,published) VALUES(?,?,?,?,?,?,1)",
            ("mdl-counted", self.franchise_id, leaf_id, "destruidor", "TS-COUNTED", "Destruidor"),
        )
        counts = self.db.execute(
            "SELECT path,direct_model_count,subtree_model_count FROM catalog_folders ORDER BY depth,path"
        ).fetchall()
        self.assertEqual(counts, [
            ("viloes", 0, 1),
            ("viloes/destruidor", 1, 1),
        ])

        self.db.execute("UPDATE models SET published=0 WHERE id='mdl-counted'")
        counts = self.db.execute(
            "SELECT direct_model_count,subtree_model_count FROM catalog_folders ORDER BY depth,path"
        ).fetchall()
        self.assertEqual(counts, [(0, 0), (0, 0)])

        self.db.execute("UPDATE models SET published=1 WHERE id='mdl-counted'")
        counts = self.db.execute(
            "SELECT direct_model_count,subtree_model_count FROM catalog_folders ORDER BY depth,path"
        ).fetchall()
        self.assertEqual(counts, [(0, 1), (1, 1)])

        self.db.execute("DELETE FROM models WHERE id='mdl-counted'")
        counts = self.db.execute(
            "SELECT direct_model_count,subtree_model_count FROM catalog_folders ORDER BY depth,path"
        ).fetchall()
        self.assertEqual(counts, [(0, 0), (0, 0)])

    def test_materialized_folder_counts_follow_folder_move(self) -> None:
        for slug in ("a", "b"):
            self.db.execute(
                "INSERT INTO catalog_folders(franchise_id,slug,name,path,depth) VALUES(?,?,?,?,1)",
                (self.franchise_id, slug, slug.upper(), slug),
            )
        a_id = self.db.execute("SELECT id FROM catalog_folders WHERE path='a'").fetchone()[0]
        b_id = self.db.execute("SELECT id FROM catalog_folders WHERE path='b'").fetchone()[0]
        self.db.execute(
            "INSERT INTO models(id,franchise_id,folder_id,slug,code,name,published) VALUES(?,?,?,?,?,?,1)",
            ("mdl-move", self.franchise_id, a_id, "move", "TS-MOVE", "Move"),
        )
        self.db.execute("UPDATE models SET folder_id=? WHERE id='mdl-move'", (b_id,))

        counts = dict(self.db.execute(
            "SELECT path,subtree_model_count FROM catalog_folders"
        ).fetchall())
        self.assertEqual(counts, {"a": 0, "b": 1})

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

    def test_folder_ancestor_trail_is_ordered_root_to_leaf(self) -> None:
        self.db.execute(
            "INSERT INTO catalog_folders(franchise_id,slug,name,path,depth) VALUES(?,?,?,?,?)",
            (self.franchise_id, "viloes", "Vil\u00f5es", "viloes", 1),
        )
        villains_id = self.db.execute("SELECT id FROM catalog_folders WHERE path='viloes'").fetchone()[0]
        self.db.execute(
            "INSERT INTO catalog_folders(franchise_id,parent_id,slug,name,path,depth) VALUES(?,?,?,?,?,?)",
            (self.franchise_id, villains_id, "destruidor", "Destruidor", "viloes/destruidor", 2),
        )
        rows = self.db.execute(
            """WITH RECURSIVE ancestors AS (
              SELECT id,parent_id,path,name,depth
              FROM catalog_folders
              WHERE franchise_id=? AND path=?
              UNION ALL
              SELECT parent.id,parent.parent_id,parent.path,parent.name,parent.depth
              FROM catalog_folders parent
              JOIN ancestors child ON child.parent_id=parent.id
            )
            SELECT path,name FROM ancestors ORDER BY depth,path""",
            (self.franchise_id, "viloes/destruidor"),
        ).fetchall()
        self.assertEqual(rows, [("viloes", "Vil\u00f5es"), ("viloes/destruidor", "Destruidor")])

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


    def test_gallery_relation_retires_source_and_updates_materialized_counts(self) -> None:
        self.db.execute(
            "INSERT INTO catalog_folders(franchise_id,slug,name,path,depth) VALUES(?,?,?,?,1)",
            (self.franchise_id, "grupo", "Grupo", "grupo"),
        )
        folder_id = self.db.execute(
            "SELECT id FROM catalog_folders WHERE franchise_id=? AND path='grupo'",
            (self.franchise_id,),
        ).fetchone()[0]
        self._insert_gallery_model("mdl-canonical", folder_id, "canonical", "TS-CAN", "Produto")
        self._insert_gallery_model("mdl-source", folder_id, "source", "TS-SRC", "Produto")

        self.assertEqual(
            self.db.execute("SELECT model_count FROM franchises WHERE id=?", (self.franchise_id,)).fetchone()[0],
            2,
        )
        self.assertEqual(
            self.db.execute(
                "SELECT subtree_model_count FROM catalog_folders WHERE id=?", (folder_id,)
            ).fetchone()[0],
            2,
        )

        self.db.execute(
            "INSERT INTO model_gallery_members(canonical_model_id,source_model_id,position) VALUES(?,?,?)",
            ("mdl-canonical", "mdl-source", 1),
        )

        self.assertEqual(
            self.db.execute("SELECT published FROM models WHERE id='mdl-source'").fetchone()[0],
            0,
        )
        self.assertEqual(
            self.db.execute("SELECT model_count FROM franchises WHERE id=?", (self.franchise_id,)).fetchone()[0],
            1,
        )
        self.assertEqual(
            self.db.execute(
                "SELECT subtree_model_count FROM catalog_folders WHERE id=?", (folder_id,)
            ).fetchone()[0],
            1,
        )

    def test_retired_source_still_contributes_to_logical_gallery(self) -> None:
        self.db.execute(
            "INSERT INTO catalog_folders(franchise_id,slug,name,path,depth) VALUES(?,?,?,?,1)",
            (self.franchise_id, "grupo", "Grupo", "grupo"),
        )
        folder_id = self.db.execute(
            "SELECT id FROM catalog_folders WHERE franchise_id=? AND path='grupo'",
            (self.franchise_id,),
        ).fetchone()[0]
        self._insert_gallery_model("mdl-a", folder_id, "a", "TS-A", "Produto")
        self._insert_gallery_model("mdl-b", folder_id, "b", "TS-B", "Produto")
        self.db.execute("UPDATE models SET gallery_version=3 WHERE id='mdl-a'")
        self.db.execute("UPDATE models SET gallery_version=5 WHERE id='mdl-b'")

        self.db.execute(
            "INSERT INTO model_gallery_members(canonical_model_id,source_model_id,position) VALUES(?,?,?)",
            ("mdl-a", "mdl-b", 1),
        )

        logical = self.db.execute(
            """SELECT
            canonical.image_count + COALESCE(SUM(source.image_count),0),
            canonical.gallery_version + COALESCE(SUM(source.gallery_version),0)
            FROM models canonical
            LEFT JOIN model_gallery_members member ON member.canonical_model_id=canonical.id
            LEFT JOIN models source ON source.id=member.source_model_id
            WHERE canonical.id='mdl-a'
            GROUP BY canonical.id"""
        ).fetchone()
        source_published = self.db.execute(
            "SELECT published FROM models WHERE id='mdl-b'"
        ).fetchone()[0]

        self.assertEqual(source_published, 0)
        self.assertEqual(logical, (2, 8))

    def test_attached_gallery_source_cannot_be_republished_or_rebound(self) -> None:
        self.db.execute(
            "INSERT INTO catalog_folders(franchise_id,slug,name,path,depth) VALUES(?,?,?,?,1)",
            (self.franchise_id, "grupo", "Grupo", "grupo"),
        )
        folder_id = self.db.execute(
            "SELECT id FROM catalog_folders WHERE franchise_id=? AND path='grupo'",
            (self.franchise_id,),
        ).fetchone()[0]
        for model_id in ("mdl-a", "mdl-b", "mdl-c"):
            self._insert_gallery_model(model_id, folder_id, model_id, f"TS-{model_id}", "Produto")

        self.db.execute(
            "INSERT INTO model_gallery_members(canonical_model_id,source_model_id,position) VALUES(?,?,?)",
            ("mdl-a", "mdl-b", 1),
        )

        with self.assertRaises(sqlite3.IntegrityError):
            self.db.execute("UPDATE models SET published=1 WHERE id='mdl-b'")
        with self.assertRaises(sqlite3.IntegrityError):
            self.db.execute(
                "UPDATE model_gallery_members SET source_model_id='mdl-c' "
                "WHERE canonical_model_id='mdl-a' AND source_model_id='mdl-b'"
            )

    def test_gallery_relation_requires_publishable_manifests(self) -> None:
        self.db.execute(
            "INSERT INTO catalog_folders(franchise_id,slug,name,path,depth) VALUES(?,?,?,?,1)",
            (self.franchise_id, "grupo", "Grupo", "grupo"),
        )
        folder_id = self.db.execute(
            "SELECT id FROM catalog_folders WHERE franchise_id=? AND path='grupo'",
            (self.franchise_id,),
        ).fetchone()[0]
        self._insert_gallery_model("mdl-a", folder_id, "a", "TS-A", "Produto")
        self.db.execute(
            "INSERT INTO models(id,franchise_id,folder_id,slug,code,name,published) VALUES(?,?,?,?,?,?,1)",
            ("mdl-b", self.franchise_id, folder_id, "b", "TS-B", "Produto"),
        )

        with self.assertRaises(sqlite3.IntegrityError):
            self.db.execute(
                "INSERT INTO model_gallery_members(canonical_model_id,source_model_id,position) VALUES(?,?,?)",
                ("mdl-a", "mdl-b", 1),
            )

    def test_gallery_members_reject_chains_and_cycles(self) -> None:
        self.db.execute(
            "INSERT INTO catalog_folders(franchise_id,slug,name,path,depth) VALUES(?,?,?,?,?)",
            (self.franchise_id, "grupo", "Grupo", "grupo", 1),
        )
        folder_id = self.db.execute(
            "SELECT id FROM catalog_folders WHERE franchise_id=? AND path='grupo'",
            (self.franchise_id,),
        ).fetchone()[0]
        for model_id, slug in (("mdl-a", "a"), ("mdl-b", "b"), ("mdl-c", "c")):
            self._insert_gallery_model(model_id, folder_id, slug, f"TS-{slug}", "Mesmo Produto")

        self.db.execute(
            "INSERT INTO model_gallery_members(canonical_model_id,source_model_id,position) VALUES(?,?,?)",
            ("mdl-a", "mdl-b", 1),
        )

        with self.assertRaises(sqlite3.IntegrityError):
            self.db.execute(
                "INSERT INTO model_gallery_members(canonical_model_id,source_model_id,position) VALUES(?,?,?)",
                ("mdl-b", "mdl-c", 1),
            )
        with self.assertRaises(sqlite3.IntegrityError):
            self.db.execute(
                "INSERT INTO model_gallery_members(canonical_model_id,source_model_id,position) VALUES(?,?,?)",
                ("mdl-c", "mdl-a", 1),
            )

    def test_gallery_members_reject_different_folder_or_public_name(self) -> None:
        for path in ("grupo-a", "grupo-b"):
            self.db.execute(
                "INSERT INTO catalog_folders(franchise_id,slug,name,path,depth) VALUES(?,?,?,?,1)",
                (self.franchise_id, path, path, path),
            )
        folder_a = self.db.execute(
            "SELECT id FROM catalog_folders WHERE franchise_id=? AND path='grupo-a'",
            (self.franchise_id,),
        ).fetchone()[0]
        folder_b = self.db.execute(
            "SELECT id FROM catalog_folders WHERE franchise_id=? AND path='grupo-b'",
            (self.franchise_id,),
        ).fetchone()[0]

        rows = (
            ("mdl-a", folder_a, "a", "TS-A", "Produto"),
            ("mdl-b", folder_b, "b", "TS-B", "Produto"),
            ("mdl-c", folder_a, "c", "TS-C", "Outro Produto"),
        )
        for model_id, folder_id, slug, code, name in rows:
            self._insert_gallery_model(model_id, folder_id, slug, code, name)

        with self.assertRaises(sqlite3.IntegrityError):
            self.db.execute(
                "INSERT INTO model_gallery_members(canonical_model_id,source_model_id,position) VALUES(?,?,?)",
                ("mdl-a", "mdl-b", 1),
            )
        with self.assertRaises(sqlite3.IntegrityError):
            self.db.execute(
                "INSERT INTO model_gallery_members(canonical_model_id,source_model_id,position) VALUES(?,?,?)",
                ("mdl-a", "mdl-c", 1),
            )

    def test_gallery_members_are_unique_ordered_aliases(self) -> None:
        self.db.execute(
            "INSERT INTO catalog_folders(franchise_id,slug,name,path,depth) VALUES(?,?,?,?,?)",
            (self.franchise_id, "androides", "Androides", "androides", 1),
        )
        folder_id = self.db.execute(
            "SELECT id FROM catalog_folders WHERE franchise_id=? AND path='androides'",
            (self.franchise_id,),
        ).fetchone()[0]
        for model_id, slug in (("mdl-front", "front"), ("mdl-side", "side"), ("mdl-back", "back")):
            self._insert_gallery_model(model_id, folder_id, slug, f"TS-{slug}", "Modelo")

        self.db.execute(
            "INSERT INTO model_gallery_members(canonical_model_id,source_model_id,position) VALUES(?,?,?)",
            ("mdl-front", "mdl-side", 1),
        )
        self.db.execute(
            "INSERT INTO model_gallery_members(canonical_model_id,source_model_id,position) VALUES(?,?,?)",
            ("mdl-front", "mdl-back", 2),
        )

        rows = self.db.execute(
            "SELECT source_model_id,position FROM model_gallery_members WHERE canonical_model_id=? ORDER BY position",
            ("mdl-front",),
        ).fetchall()
        self.assertEqual(rows, [("mdl-side", 1), ("mdl-back", 2)])

        with self.assertRaises(sqlite3.IntegrityError):
            self.db.execute(
                "INSERT INTO model_gallery_members(canonical_model_id,source_model_id,position) VALUES(?,?,?)",
                ("mdl-side", "mdl-back", 1),
            )
        with self.assertRaises(sqlite3.IntegrityError):
            self.db.execute(
                "INSERT INTO model_gallery_members(canonical_model_id,source_model_id,position) VALUES(?,?,?)",
                ("mdl-front", "mdl-front", 3),
            )


if __name__ == "__main__":
    unittest.main()
