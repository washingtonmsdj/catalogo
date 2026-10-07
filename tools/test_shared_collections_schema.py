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
        for name in (
            "0001_catalog.sql",
            "0003_catalog_counts.sql",
            "0008_shared_collections.sql",
            "0009_catalog_folders.sql",
            "0011_model_gallery_members.sql",
            "0014_gallery_member_integrity.sql",
            "0015_gallery_publication_invariant.sql",
        ):
            self.db.executescript((MIGRATIONS / name).read_text(encoding="utf-8"))
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

    def test_shared_collection_old_source_id_resolves_to_canonical_after_retirement(self) -> None:
        franchise_id = self.db.execute(
            "SELECT id FROM franchises WHERE slug='resident-evil'"
        ).fetchone()[0]
        self.db.execute(
            """UPDATE models SET
            image_count=1,
            cover_storage_key='media/mdl-1/card.webp',
            gallery_manifest_key='gallery/mdl-1/manifest.json',
            gallery_version=1
            WHERE id='mdl-1'"""
        )
        self.db.execute(
            """INSERT INTO models(
            id,franchise_id,slug,code,name,image_count,cover_storage_key,
            gallery_manifest_key,gallery_version,published)
            VALUES(?,?,?,?,?,1,?,?,1,1)""",
            (
                "mdl-old-view",
                franchise_id,
                "leon-costas",
                "RE-OLD",
                "Leon",
                "media/mdl-old-view/card.webp",
                "gallery/mdl-old-view/manifest.json",
            ),
        )
        self.db.execute(
            "INSERT INTO shared_collections(code,fingerprint,name,item_count,created_at,expires_at) VALUES(?,?,?,?,?,?)",
            ("TCL-old", "fp-old", "Coleção antiga", 1, 100, 200),
        )
        self.db.execute(
            "INSERT INTO shared_collection_items(collection_code,model_id,position) VALUES(?,?,?)",
            ("TCL-old", "mdl-old-view", 0),
        )

        self.db.execute(
            "INSERT INTO model_gallery_members(canonical_model_id,source_model_id,position) VALUES(?,?,?)",
            ("mdl-1", "mdl-old-view", 1),
        )
        self.assertEqual(
            self.db.execute("SELECT published FROM models WHERE id='mdl-old-view'").fetchone()[0],
            0,
        )

        resolved = self.db.execute(
            """SELECT resolved.id,resolved.slug,resolved.code,resolved.name
            FROM shared_collection_items sci
            JOIN models requested ON requested.id=sci.model_id
            LEFT JOIN model_gallery_members member ON member.source_model_id=requested.id
            JOIN models resolved ON resolved.id=COALESCE(member.canonical_model_id,requested.id)
            WHERE sci.collection_code=? AND resolved.published=1
            ORDER BY sci.position""",
            ("TCL-old",),
        ).fetchall()

        self.assertEqual(resolved, [("mdl-1", "leon", "RE-001", "Leon")])

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
