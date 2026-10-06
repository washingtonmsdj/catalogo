from __future__ import annotations

import json
import sqlite3
import tempfile
import unittest
from pathlib import Path

from publish_d1 import build_statements, load_models


def model(model_id: str, slug: str, code: str, *, variant: str) -> dict:
    return {
        "id": model_id,
        "slug": slug,
        "code": code,
        "displayName": variant,
        "categoryName": "Animes & Desenhos",
        "categorySlug": "animes-desenhos",
        "franchiseName": "Dragon Ball",
        "franchiseSlug": "dragon-ball",
        "collection": "Androides / Androide 18",
        "folderPath": ["Androides", "Androide 18"],
        "folderPathKey": "androides/androide-18",
        "searchText": f"dragon ball {variant}".casefold(),
        "imageCount": 1,
        "coverStorageKey": f"media/{model_id}/card.webp",
        "galleryManifestKey": f"gallery/{model_id}/manifest.json",
        "galleryVersion": 1,
    }


class PublishD1Tests(unittest.TestCase):
    def test_plan_deduplicates_taxonomy_but_preserves_models(self) -> None:
        rows = [
            model("mdl-1", "android-18-a", "TS-1", variant="Androide 18 A"),
            model("mdl-2", "android-18-b", "TS-2", variant="Androide 18 B"),
        ]

        statements = build_statements(rows)

        self.assertEqual(len(statements), 6)
        self.assertIn("INSERT INTO categories", statements[0]["sql"])
        self.assertIn("INSERT INTO franchises", statements[1]["sql"])
        self.assertEqual(sum("INSERT INTO catalog_folders" in item["sql"] for item in statements), 2)
        self.assertEqual(sum("INSERT INTO models" in item["sql"] for item in statements), 2)
        self.assertFalse(any("DELETE" in item["sql"].upper() for item in statements))

    def test_load_rejects_duplicate_public_slug(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "models.jsonl"
            rows = [
                model("mdl-1", "same", "TS-1", variant="A"),
                model("mdl-2", "same", "TS-2", variant="B"),
            ]
            path.write_text("".join(json.dumps(row) + "\n" for row in rows), encoding="utf-8")

            with self.assertRaisesRegex(RuntimeError, "slug vazio ou duplicado"):
                load_models(path)

    def test_statements_apply_idempotently_against_catalog_schema(self) -> None:
        db = sqlite3.connect(':memory:')
        migrations = Path(__file__).resolve().parents[1] / 'migrations'
        for name in ('0001_catalog.sql', '0002_keyset_pagination.sql', '0003_catalog_counts.sql', '0009_catalog_folders.sql'):
            db.executescript((migrations / name).read_text(encoding='utf-8'))
        rows = [
            model('mdl-1', 'android-18-a', 'TS-1', variant='Androide 18 A'),
            model('mdl-2', 'android-18-b', 'TS-2', variant='Androide 18 B'),
        ]
        statements = build_statements(rows)
        for _ in range(2):
            with db:
                for statement in statements:
                    db.execute(statement['sql'], statement['params'])
        self.assertEqual(db.execute('SELECT COUNT(*) FROM models').fetchone()[0], 2)
        self.assertEqual(db.execute('SELECT COUNT(*) FROM catalog_folders').fetchone()[0], 2)
        self.assertEqual(db.execute('SELECT COUNT(*) FROM models WHERE folder_id IS NOT NULL').fetchone()[0], 2)
        self.assertEqual(db.execute('SELECT model_count FROM franchises').fetchone()[0], 2)
        self.assertEqual(db.execute('SELECT model_count FROM categories').fetchone()[0], 2)

    def test_republish_preserves_created_at_for_recent_feed_semantics(self) -> None:
        db = sqlite3.connect(':memory:')
        migrations = Path(__file__).resolve().parents[1] / 'migrations'
        for name in ('0001_catalog.sql', '0002_keyset_pagination.sql', '0003_catalog_counts.sql', '0009_catalog_folders.sql'):
            db.executescript((migrations / name).read_text(encoding='utf-8'))

        row = model('mdl-1', 'android-18', 'TS-1', variant='Androide 18')
        for statement in build_statements([row]):
            db.execute(statement['sql'], statement['params'])
        db.execute("UPDATE models SET created_at='2026-01-01 10:00:00' WHERE id='mdl-1'")

        updated = model('mdl-1', 'android-18', 'TS-1', variant='Androide 18 revisada')
        for statement in build_statements([updated]):
            db.execute(statement['sql'], statement['params'])

        created_at, name = db.execute("SELECT created_at,name FROM models WHERE id='mdl-1'").fetchone()
        self.assertEqual(created_at, '2026-01-01 10:00:00')
        self.assertEqual(name, 'Androide 18 revisada')

    def test_recent_models_index_orders_only_published_models_deterministically(self) -> None:
        db = sqlite3.connect(':memory:')
        migrations = Path(__file__).resolve().parents[1] / 'migrations'
        for name in ('0001_catalog.sql', '0002_keyset_pagination.sql', '0003_catalog_counts.sql', '0009_catalog_folders.sql', '0010_recent_models_index.sql'):
            db.executescript((migrations / name).read_text(encoding='utf-8'))

        rows = [
            model('mdl-1', 'android-18-a', 'TS-1', variant='A'),
            model('mdl-2', 'android-18-b', 'TS-2', variant='B'),
            model('mdl-3', 'android-18-c', 'TS-3', variant='C'),
        ]
        for statement in build_statements(rows):
            db.execute(statement['sql'], statement['params'])

        db.execute("UPDATE models SET created_at='2026-01-01 10:00:00' WHERE id='mdl-1'")
        db.execute("UPDATE models SET created_at='2026-01-02 10:00:00' WHERE id IN ('mdl-2','mdl-3')")
        db.execute("UPDATE models SET published=0 WHERE id='mdl-3'")

        ids = [
            row[0]
            for row in db.execute(
                'SELECT id FROM models WHERE published=1 ORDER BY created_at DESC,id DESC LIMIT 24'
            ).fetchall()
        ]
        self.assertEqual(ids, ['mdl-2', 'mdl-1'])

        plan = ' '.join(
            str(part)
            for row in db.execute(
                'EXPLAIN QUERY PLAN SELECT id FROM models WHERE published=1 ORDER BY created_at DESC,id DESC LIMIT 24'
            ).fetchall()
            for part in row
        )
        self.assertIn('idx_models_published_created', plan)

    def test_load_rejects_category_outside_public_scope(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "models.jsonl"
            row = model("mdl-1", "interno", "TS-1", variant="Interno")
            row["categoryName"] = "Referências Internas"
            row["categorySlug"] = "referencias-internas"
            path.write_text(json.dumps(row) + "\n", encoding="utf-8")

            with self.assertRaisesRegex(RuntimeError, "fora do escopo público"):
                load_models(path)

    def test_load_rejects_model_without_publishable_image(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "models.jsonl"
            row = model("mdl-1", "android-18", "TS-1", variant="Androide 18")
            row["imageCount"] = 0
            path.write_text(json.dumps(row) + "\n", encoding="utf-8")

            with self.assertRaisesRegex(RuntimeError, "modelo sem imagem publicável"):
                load_models(path)


if __name__ == "__main__":
    unittest.main()
