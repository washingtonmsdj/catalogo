from __future__ import annotations

import json
import sqlite3
import tempfile
import unittest
from pathlib import Path

from PIL import Image

from build_media_bundle import build_bundle
from publish_d1 import build_statements, validate_production_compatibility


class MultiImageReleaseContractTests(unittest.TestCase):
    def _apply_schema(self, db: sqlite3.Connection) -> None:
        migrations = Path(__file__).resolve().parents[1] / "migrations"
        for name in (
            "0001_catalog.sql",
            "0002_keyset_pagination.sql",
            "0003_catalog_counts.sql",
            "0009_catalog_folders.sql",
            "0019_model_variant_name.sql",
        ):
            db.executescript((migrations / name).read_text(encoding="utf-8"))

    def _apply_rows(self, db: sqlite3.Connection, rows: list[dict]) -> None:
        with db:
            for statement in build_statements(rows):
                db.execute(statement["sql"], statement["params"])

    def _production_rows(self, db: sqlite3.Connection) -> list[dict]:
        cursor = db.execute(
            """SELECT
            m.id,m.slug,m.code,m.name,m.collection,
            COALESCE(cf.path,'') AS folder_path,
            m.image_count,m.cover_storage_key,m.gallery_manifest_key,m.gallery_version,
            c.slug AS category_slug,f.slug AS franchise_slug
            FROM models m
            JOIN franchises f ON f.id=m.franchise_id
            JOIN categories c ON c.id=f.category_id
            LEFT JOIN catalog_folders cf ON cf.id=m.folder_id"""
        )
        columns = [item[0] for item in cursor.description]
        return [dict(zip(columns, row)) for row in cursor.fetchall()]

    def _write_manifest(self, path: Path, rows: list[dict]) -> None:
        path.write_text(
            "".join(json.dumps(row, ensure_ascii=False) + "\n" for row in rows),
            encoding="utf-8",
        )

    def test_existing_product_expands_from_one_to_three_images_without_identity_split(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            source = root / "catalog"
            model_dir = (
                source
                / "OK - Games [3]"
                / "OK - God of War [3]"
                / "OK - Kratos [3]"
            )
            model_dir.mkdir(parents=True)

            front = model_dir / "kratos-frente.webp"
            back = model_dir / "kratos-costas.webp"
            side = model_dir / "kratos-lateral.webp"
            Image.new("RGB", (1000, 1500), "#334455").save(front, "WEBP")
            Image.new("RGB", (900, 1350), "#445566").save(back, "WEBP")
            Image.new("RGB", (850, 1275), "#556677").save(side, "WEBP")

            hierarchy = "Games / God of War / Kratos"
            public_key = f"{hierarchy} / kratos-modelo-01"

            def row(path: Path, sha: str, quality: float) -> dict:
                with Image.open(path) as image:
                    width, height = image.size
                return {
                    "path": str(path.relative_to(source)),
                    "size": path.stat().st_size,
                    "status": "OK",
                    "canonical": True,
                    "sha256": sha,
                    "width": width,
                    "height": height,
                    "quality_score": quality,
                    "model_key": hierarchy,
                    "public_model_key": public_key,
                    "audit_model_group": "kratos-modelo-01",
                }

            initial_rows = [row(front, "a" * 64, 95.0)]
            expanded_rows = [
                row(front, "a" * 64, 95.0),
                row(back, "b" * 64, 85.0),
                row(side, "c" * 64, 80.0),
            ]

            initial_manifest = root / "initial.jsonl"
            expanded_manifest = root / "expanded.jsonl"
            self._write_manifest(initial_manifest, initial_rows)
            self._write_manifest(expanded_manifest, expanded_rows)

            initial_output = root / "bundle-initial"
            expanded_output = root / "bundle-expanded"
            build_bundle(source, initial_manifest, initial_output, include_original=False)
            build_bundle(source, expanded_manifest, expanded_output, include_original=False)

            initial = json.loads((initial_output / "models.jsonl").read_text(encoding="utf-8"))
            expanded = json.loads((expanded_output / "models.jsonl").read_text(encoding="utf-8"))

            self.assertEqual(initial["imageCount"], 1)
            self.assertEqual(expanded["imageCount"], 3)
            self.assertEqual(initial["id"], expanded["id"])
            self.assertEqual(initial["slug"], expanded["slug"])
            self.assertEqual(initial["code"], expanded["code"])
            self.assertEqual(initial["displayName"], expanded["displayName"])
            self.assertEqual(initial["coverStorageKey"], expanded["coverStorageKey"])
            self.assertNotEqual(initial["galleryManifestKey"], expanded["galleryManifestKey"])
            self.assertNotEqual(initial["galleryVersion"], expanded["galleryVersion"])

            db = sqlite3.connect(":memory:")
            self._apply_schema(db)
            self._apply_rows(db, [initial])

            baseline = self._production_rows(db)
            compatibility = validate_production_compatibility([expanded], baseline)
            self.assertTrue(compatibility["ready"])
            self.assertEqual(compatibility["existingModels"], 1)
            self.assertEqual(compatibility["newModels"], 0)
            self.assertEqual(compatibility["expandedGalleries"], 1)
            self.assertEqual(compatibility["reducedGalleries"], 0)

            self._apply_rows(db, [expanded])
            final = db.execute(
                "SELECT id,slug,code,name,image_count,cover_storage_key,gallery_manifest_key,gallery_version "
                "FROM models"
            ).fetchall()

            self.assertEqual(len(final), 1)
            (
                model_id,
                slug,
                code,
                name,
                image_count,
                cover_key,
                gallery_key,
                gallery_version,
            ) = final[0]
            self.assertEqual(model_id, initial["id"])
            self.assertEqual(slug, initial["slug"])
            self.assertEqual(code, initial["code"])
            self.assertEqual(name, "Kratos")
            self.assertEqual(image_count, 3)
            self.assertEqual(cover_key, initial["coverStorageKey"])
            self.assertEqual(gallery_key, expanded["galleryManifestKey"])
            self.assertEqual(gallery_version, expanded["galleryVersion"])

            gallery = json.loads(
                (expanded_output / "r2" / expanded["galleryManifestKey"]).read_text(encoding="utf-8")
            )
            self.assertEqual(gallery["modelId"], model_id)
            self.assertEqual(gallery["version"], gallery_version)
            self.assertEqual(len(gallery["images"]), image_count)
            self.assertEqual(gallery["images"][0]["role"], "cover")
            self.assertEqual(
                {item["sourceSha256"] for item in gallery["images"]},
                {"a" * 64, "b" * 64, "c" * 64},
            )


if __name__ == "__main__":
    unittest.main()
