from __future__ import annotations

import json
import sqlite3
import tempfile
import unittest
from pathlib import Path

from publish_d1 import CATEGORY_ORDER, build_statements, load_models, production_lookup_statements, read_gallery_shrink_approvals, validate_production_compatibility


def model(model_id: str, slug: str, code: str, *, variant: str) -> dict:
    return {
        "identityKey": f"test/{model_id}",
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
    def test_category_order_is_derived_from_public_scope_ssot(self) -> None:
        self.assertEqual(
            CATEGORY_ORDER,
            {
                "Animes & Desenhos": 10,
                "Games": 20,
                "Filmes & Séries": 30,
                "Marvel & DC": 40,
                "Tokusatsu & Cultura Japonesa": 50,
                "Pessoas": 60,
            },
        )

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

    def test_load_rejects_duplicate_identity_key(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "models.jsonl"
            rows = [
                model("mdl-1", "a", "TS-1", variant="A"),
                model("mdl-2", "b", "TS-2", variant="B"),
            ]
            rows[1]["identityKey"] = rows[0]["identityKey"]
            path.write_text("".join(json.dumps(row) + "\n" for row in rows), encoding="utf-8")

            with self.assertRaisesRegex(RuntimeError, "identityKey vazio ou duplicado"):
                load_models(path)

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

    def test_load_rejects_high_confidence_split_view_products(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "models.jsonl"
            rows = [
                model("mdl-front", "dragon-ball-recoome-busto-frente", "TS-FRONT", variant="Recoome"),
                model("mdl-side", "dragon-ball-recoome-busto-lateral", "TS-SIDE", variant="Recoome"),
                model("mdl-back", "dragon-ball-recoome-busto-costas", "TS-BACK", variant="Recoome"),
            ]
            path.write_text("".join(json.dumps(row) + "\n" for row in rows), encoding="utf-8")

            with self.assertRaisesRegex(RuntimeError, "fichas fragmentadas por vista"):
                load_models(path)

    def test_load_allows_framing_pair_for_explicit_review(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "models.jsonl"
            rows = [
                model("mdl-full", "dragon-ball-cell-primeira-forma-corpo-inteiro", "TS-FULL", variant="Cell"),
                model("mdl-stand", "dragon-ball-cell-primeira-forma-em-pe", "TS-STAND", variant="Cell"),
            ]
            path.write_text("".join(json.dumps(row) + "\n" for row in rows), encoding="utf-8")

            loaded = load_models(path)

            self.assertEqual(len(loaded), 2)

    def test_load_rejects_category_outside_public_scope(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "models.jsonl"
            row = model("mdl-1", "interno", "TS-1", variant="Interno")
            row["categoryName"] = "Referências Internas"
            row["categorySlug"] = "referencias-internas"
            path.write_text(json.dumps(row) + "\n", encoding="utf-8")

            with self.assertRaisesRegex(RuntimeError, "fora do escopo público"):
                load_models(path)

    def test_production_compatibility_allows_existing_model_and_new_model(self) -> None:
        existing = model("mdl-1", "android-18-a", "TS-1", variant="Androide 18 A")
        new_model = model("mdl-2", "android-18-b", "TS-2", variant="Androide 18 B")
        production = [{
            "id": "mdl-1",
            "slug": "android-18-a",
            "code": "TS-1",
            "name": "Androide 18 A",
            "collection": "Androides / Androide 18",
            "folder_path": "androides/androide-18",
            "image_count": 1,
            "cover_storage_key": "media/mdl-1/card.webp",
            "gallery_manifest_key": "gallery/mdl-1/manifest.json",
            "gallery_version": 1,
            "category_slug": "animes-desenhos",
            "franchise_slug": "dragon-ball",
        }]

        result = validate_production_compatibility([existing, new_model], production)

        self.assertTrue(result["ready"])
        self.assertEqual(result["existingModels"], 1)
        self.assertEqual(result["newModels"], 1)

    def test_production_compatibility_rejects_new_id_with_existing_slug(self) -> None:
        candidate = model("mdl-new", "android-18", "TS-NEW", variant="Androide 18")
        production = [{
            "id": "mdl-old",
            "slug": "android-18",
            "code": "TS-OLD",
            "name": "Androide 18",
            "collection": "Androides / Androide 18",
            "folder_path": "androides/androide-18",
            "image_count": 1,
            "cover_storage_key": "media/mdl-1/card.webp",
            "gallery_manifest_key": "gallery/mdl-1/manifest.json",
            "gallery_version": 1,
            "category_slug": "animes-desenhos",
            "franchise_slug": "dragon-ball",
        }]

        with self.assertRaisesRegex(RuntimeError, "colide com slug já publicado"):
            validate_production_compatibility([candidate], production)

    def test_production_compatibility_rejects_new_id_with_existing_code(self) -> None:
        candidate = model("mdl-new", "android-18-new", "TS-OLD", variant="Androide 18")
        production = [{
            "id": "mdl-old",
            "slug": "android-18-old",
            "code": "TS-OLD",
            "name": "Androide 18",
            "collection": "Androides / Androide 18",
            "folder_path": "androides/androide-18",
            "image_count": 1,
            "cover_storage_key": "media/mdl-1/card.webp",
            "gallery_manifest_key": "gallery/mdl-1/manifest.json",
            "gallery_version": 1,
            "category_slug": "animes-desenhos",
            "franchise_slug": "dragon-ball",
        }]

        with self.assertRaisesRegex(RuntimeError, "colide com código já publicado"):
            validate_production_compatibility([candidate], production)

    def test_production_compatibility_rejects_slug_change_for_existing_id(self) -> None:
        candidate = model("mdl-1", "slug-novo", "TS-1", variant="Androide 18")
        production = [{
            "id": "mdl-1",
            "slug": "slug-antigo",
            "code": "TS-1",
            "name": "Androide 18",
            "collection": "Androides / Androide 18",
            "folder_path": "androides/androide-18",
            "image_count": 1,
            "cover_storage_key": "media/mdl-1/card.webp",
            "gallery_manifest_key": "gallery/mdl-1/manifest.json",
            "gallery_version": 1,
            "category_slug": "animes-desenhos",
            "franchise_slug": "dragon-ball",
        }]

        with self.assertRaisesRegex(RuntimeError, "slug de modelo publicado mudaria"):
            validate_production_compatibility([candidate], production)

    def test_production_compatibility_rejects_code_change_for_existing_id(self) -> None:
        candidate = model("mdl-1", "android-18", "TS-NEW", variant="Androide 18")
        production = [{
            "id": "mdl-1",
            "slug": "android-18",
            "code": "TS-OLD",
            "name": "Androide 18",
            "collection": "Androides / Androide 18",
            "folder_path": "androides/androide-18",
            "image_count": 1,
            "cover_storage_key": "media/mdl-1/card.webp",
            "gallery_manifest_key": "gallery/mdl-1/manifest.json",
            "gallery_version": 1,
            "category_slug": "animes-desenhos",
            "franchise_slug": "dragon-ball",
        }]

        with self.assertRaisesRegex(RuntimeError, "código de modelo publicado mudaria"):
            validate_production_compatibility([candidate], production)

    def test_production_compatibility_rejects_taxonomy_move_without_explicit_migration(self) -> None:
        candidate = model("mdl-1", "android-18", "TS-1", variant="Androide 18")
        production = [{
            "id": "mdl-1",
            "slug": "android-18",
            "code": "TS-1",
            "category_slug": "games",
            "franchise_slug": "dragon-ball",
        }]

        with self.assertRaisesRegex(RuntimeError, "categoria de modelo publicado mudaria"):
            validate_production_compatibility([candidate], production)

    def test_production_compatibility_rejects_public_name_change_without_migration(self) -> None:
        candidate = model("mdl-1", "android-18", "TS-1", variant="Androide 18 Revisada")
        production = [{
            "id": "mdl-1",
            "slug": "android-18",
            "code": "TS-1",
            "name": "Androide 18",
            "collection": "Androides / Androide 18",
            "folder_path": "androides/androide-18",
            "image_count": 1,
            "cover_storage_key": "media/mdl-1/card.webp",
            "gallery_manifest_key": "gallery/mdl-1/manifest.json",
            "gallery_version": 1,
            "category_slug": "animes-desenhos",
            "franchise_slug": "dragon-ball",
        }]

        with self.assertRaisesRegex(RuntimeError, "nome de modelo publicado mudaria"):
            validate_production_compatibility([candidate], production)

    def test_production_compatibility_rejects_collection_change_without_migration(self) -> None:
        candidate = model("mdl-1", "android-18", "TS-1", variant="Androide 18")
        candidate["collection"] = "Androides / Outra Coleção"
        production = [{
            "id": "mdl-1",
            "slug": "android-18",
            "code": "TS-1",
            "name": "Androide 18",
            "collection": "Androides / Androide 18",
            "folder_path": "androides/androide-18",
            "image_count": 1,
            "cover_storage_key": "media/mdl-1/card.webp",
            "gallery_manifest_key": "gallery/mdl-1/manifest.json",
            "gallery_version": 1,
            "category_slug": "animes-desenhos",
            "franchise_slug": "dragon-ball",
        }]

        with self.assertRaisesRegex(RuntimeError, "coleção de modelo publicado mudaria"):
            validate_production_compatibility([candidate], production)

    def test_production_compatibility_rejects_folder_move_without_migration(self) -> None:
        candidate = model("mdl-1", "android-18", "TS-1", variant="Androide 18")
        candidate["folderPath"] = ["Androides", "Outra Pasta"]
        candidate["folderPathKey"] = "androides/outra-pasta"
        production = [{
            "id": "mdl-1",
            "slug": "android-18",
            "code": "TS-1",
            "name": "Androide 18",
            "collection": "Androides / Androide 18",
            "folder_path": "androides/androide-18",
            "image_count": 1,
            "cover_storage_key": "media/mdl-1/card.webp",
            "gallery_manifest_key": "gallery/mdl-1/manifest.json",
            "gallery_version": 1,
            "category_slug": "animes-desenhos",
            "franchise_slug": "dragon-ball",
        }]

        with self.assertRaisesRegex(RuntimeError, "pasta de modelo publicado mudaria"):
            validate_production_compatibility([candidate], production)

    def test_production_compatibility_allows_gallery_expansion_with_new_version(self) -> None:
        candidate = model("mdl-1", "android-18", "TS-1", variant="Androide 18")
        candidate["imageCount"] = 3
        candidate["galleryManifestKey"] = "gallery/mdl-1/new-gallery.json"
        candidate["galleryVersion"] = 2
        production = [{
            "id": "mdl-1",
            "slug": "android-18",
            "code": "TS-1",
            "name": "Androide 18",
            "collection": "Androides / Androide 18",
            "folder_path": "androides/androide-18",
            "image_count": 1,
            "cover_storage_key": "media/mdl-1/card.webp",
            "gallery_manifest_key": "gallery/mdl-1/manifest.json",
            "gallery_version": 1,
            "category_slug": "animes-desenhos",
            "franchise_slug": "dragon-ball",
        }]

        result = validate_production_compatibility([candidate], production)

        self.assertEqual(result["expandedGalleries"], 1)
        self.assertEqual(result["reducedGalleries"], 0)

    def test_production_compatibility_blocks_gallery_shrink_without_approval(self) -> None:
        candidate = model("mdl-1", "android-18", "TS-1", variant="Androide 18")
        candidate["imageCount"] = 1
        candidate["galleryManifestKey"] = "gallery/mdl-1/reduced.json"
        candidate["galleryVersion"] = 2
        production = [{
            "id": "mdl-1",
            "slug": "android-18",
            "code": "TS-1",
            "name": "Androide 18",
            "collection": "Androides / Androide 18",
            "folder_path": "androides/androide-18",
            "image_count": 3,
            "cover_storage_key": "media/mdl-1/card.webp",
            "gallery_manifest_key": "gallery/mdl-1/full.json",
            "gallery_version": 1,
            "category_slug": "animes-desenhos",
            "franchise_slug": "dragon-ball",
        }]

        with self.assertRaisesRegex(RuntimeError, "redução de galeria exige aprovação explícita"):
            validate_production_compatibility([candidate], production)

    def test_production_compatibility_allows_exact_gallery_shrink_approval(self) -> None:
        candidate = model("mdl-1", "android-18", "TS-1", variant="Androide 18")
        candidate["imageCount"] = 1
        candidate["galleryManifestKey"] = "gallery/mdl-1/reduced.json"
        candidate["galleryVersion"] = 2
        production = [{
            "id": "mdl-1",
            "slug": "android-18",
            "code": "TS-1",
            "name": "Androide 18",
            "collection": "Androides / Androide 18",
            "folder_path": "androides/androide-18",
            "image_count": 3,
            "cover_storage_key": "media/mdl-1/card.webp",
            "gallery_manifest_key": "gallery/mdl-1/full.json",
            "gallery_version": 1,
            "category_slug": "animes-desenhos",
            "franchise_slug": "dragon-ball",
        }]
        approvals = {
            "mdl-1": {
                "model_id": "mdl-1",
                "current_image_count": 3,
                "new_image_count": 1,
                "current_gallery_version": 1,
                "new_gallery_version": 2,
                "reason": "vista incorreta removida após revisão",
            }
        }

        result = validate_production_compatibility([candidate], production, approvals)

        self.assertEqual(result["reducedGalleries"], 1)
        self.assertEqual(result["galleryShrinkApprovalsUsed"], 1)

    def test_production_compatibility_rejects_stale_gallery_shrink_approval(self) -> None:
        candidate = model("mdl-1", "android-18", "TS-1", variant="Androide 18")
        candidate["imageCount"] = 1
        candidate["galleryManifestKey"] = "gallery/mdl-1/reduced.json"
        candidate["galleryVersion"] = 3
        production = [{
            "id": "mdl-1",
            "slug": "android-18",
            "code": "TS-1",
            "name": "Androide 18",
            "collection": "Androides / Androide 18",
            "folder_path": "androides/androide-18",
            "image_count": 3,
            "cover_storage_key": "media/mdl-1/card.webp",
            "gallery_manifest_key": "gallery/mdl-1/full.json",
            "gallery_version": 2,
            "category_slug": "animes-desenhos",
            "franchise_slug": "dragon-ball",
        }]
        approvals = {
            "mdl-1": {
                "model_id": "mdl-1",
                "current_image_count": 3,
                "new_image_count": 1,
                "current_gallery_version": 1,
                "new_gallery_version": 2,
                "reason": "aprovação antiga",
            }
        }

        with self.assertRaisesRegex(RuntimeError, "não corresponde ao delta atual"):
            validate_production_compatibility([candidate], production, approvals)

    def test_production_compatibility_requires_new_version_when_gallery_changes(self) -> None:
        candidate = model("mdl-1", "android-18", "TS-1", variant="Androide 18")
        candidate["imageCount"] = 2
        candidate["galleryManifestKey"] = "gallery/mdl-1/new.json"
        candidate["galleryVersion"] = 1
        production = [{
            "id": "mdl-1",
            "slug": "android-18",
            "code": "TS-1",
            "name": "Androide 18",
            "collection": "Androides / Androide 18",
            "folder_path": "androides/androide-18",
            "image_count": 1,
            "cover_storage_key": "media/mdl-1/card.webp",
            "gallery_manifest_key": "gallery/mdl-1/old.json",
            "gallery_version": 1,
            "category_slug": "animes-desenhos",
            "franchise_slug": "dragon-ball",
        }]

        with self.assertRaisesRegex(RuntimeError, "galeria mudou sem nova gallery_version"):
            validate_production_compatibility([candidate], production)

    def test_production_compatibility_rejects_same_manifest_with_divergent_metadata(self) -> None:
        candidate = model("mdl-1", "android-18", "TS-1", variant="Androide 18")
        candidate["imageCount"] = 2
        candidate["galleryManifestKey"] = "gallery/mdl-1/shared.json"
        candidate["galleryVersion"] = 2
        production = [{
            "id": "mdl-1",
            "slug": "android-18",
            "code": "TS-1",
            "name": "Androide 18",
            "collection": "Androides / Androide 18",
            "folder_path": "androides/androide-18",
            "image_count": 1,
            "cover_storage_key": "media/mdl-1/card.webp",
            "gallery_manifest_key": "gallery/mdl-1/shared.json",
            "gallery_version": 1,
            "category_slug": "animes-desenhos",
            "franchise_slug": "dragon-ball",
        }]

        with self.assertRaisesRegex(RuntimeError, "content-addressed igual com metadados divergentes"):
            validate_production_compatibility([candidate], production)

    def test_gallery_shrink_approval_csv_is_fail_closed(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "approvals.csv"
            path.write_text(
                "model_id,current_image_count,new_image_count,current_gallery_version,new_gallery_version,reason\n"
                "mdl-1,3,1,10,11,remoção revisada\n",
                encoding="utf-8",
            )
            approvals = read_gallery_shrink_approvals(path)
            self.assertEqual(approvals["mdl-1"]["new_image_count"], 1)

            path.write_text(
                "model_id,current_image_count,new_image_count,current_gallery_version,new_gallery_version,reason\n"
                "mdl-1,3,3,10,11,não é redução\n",
                encoding="utf-8",
            )
            with self.assertRaisesRegex(RuntimeError, "não representa redução real"):
                read_gallery_shrink_approvals(path)

    def test_production_lookup_is_bounded_and_uses_all_identity_keys(self) -> None:
        rows = [
            model(f"mdl-{index}", f"slug-{index}", f"TS-{index}", variant=f"Model {index}")
            for index in range(30)
        ]

        statements = production_lookup_statements(rows, chunk_size=25)

        self.assertEqual(len(statements), 2)
        self.assertEqual(len(statements[0]["params"]), 75)
        self.assertEqual(len(statements[1]["params"]), 15)
        self.assertIn("m.id IN", statements[0]["sql"])
        self.assertIn("m.slug IN", statements[0]["sql"])
        self.assertIn("m.code IN", statements[0]["sql"])

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
