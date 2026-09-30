from __future__ import annotations

import json
import tempfile
import unittest
from pathlib import Path

from PIL import Image

from build_media_bundle import build_bundle


class MediaBundleTests(unittest.TestCase):
    def test_bundle_generates_variants_without_upscaling(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            source = root / "catalog"
            source.mkdir()
            model_dir = source / "Games" / "Saga" / "Heroi"
            model_dir.mkdir(parents=True)

            high = model_dir / "high.png"
            low = model_dir / "low.jpg"
            ignored = model_dir / "duplicate.jpg"
            Image.new("RGB", (1800, 1200), "#45484c").save(high)
            Image.new("RGB", (300, 200), "#77716b").save(low)
            Image.new("RGB", (900, 600), "#45484c").save(ignored)

            manifest = root / "manifest.jsonl"
            rows = [
                {
                    "path": str(high.relative_to(source)), "size": high.stat().st_size, "status": "OK", "canonical": True,
                    "sha256": "a" * 64, "width": 1800, "height": 1200, "quality_score": 95.0,
                    "model_key": "Games / Saga / Heroi",
                },
                {
                    "path": str(low.relative_to(source)), "size": low.stat().st_size, "status": "OK", "canonical": True,
                    "sha256": "b" * 64, "width": 300, "height": 200, "quality_score": 40.0,
                    "model_key": "Games / Saga / Heroi",
                },
                {
                    "path": str(ignored.relative_to(source)), "size": ignored.stat().st_size, "status": "OK", "canonical": False,
                    "sha256": "c" * 64, "width": 900, "height": 600, "quality_score": 80.0,
                    "model_key": "Games / Saga / Heroi",
                },
            ]
            manifest.write_text("".join(json.dumps(row) + "\n" for row in rows), encoding="utf-8")
            output = root / "bundle"

            summary = build_bundle(source, manifest, output, include_original=False)

            self.assertEqual(summary["models"], 1)
            self.assertEqual(summary["canonicalImages"], 2)
            self.assertEqual(summary["variantFiles"], 6)

            model_index = [json.loads(line) for line in (output / "models.jsonl").read_text(encoding="utf-8").splitlines()]
            self.assertEqual(len(model_index), 1)
            self.assertEqual(model_index[0]["displayName"], "Heroi")
            self.assertEqual(model_index[0]["imageCount"], 2)

            gallery_path = output / "r2" / model_index[0]["galleryManifestKey"]
            gallery = json.loads(gallery_path.read_text(encoding="utf-8"))
            self.assertEqual(len(gallery["images"]), 2)
            self.assertEqual(gallery["images"][0]["sourceSha256"], "a" * 64)
            self.assertEqual(gallery["images"][0]["role"], "cover")

            low_item = next(item for item in gallery["images"] if item["sourceSha256"] == "b" * 64)
            for variant in low_item["variants"].values():
                self.assertLessEqual(variant["width"], 300)
                self.assertLessEqual(variant["height"], 200)

    def test_include_original_is_opt_in(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            source = root / "catalog"
            model_dir = source / "Filmes" / "Saga" / "Personagem"
            model_dir.mkdir(parents=True)
            image_path = model_dir / "vista.png"
            Image.new("RGB", (640, 960), "#202428").save(image_path)
            manifest = root / "manifest.jsonl"
            manifest.write_text(json.dumps({
                "path": str(image_path.relative_to(source)), "size": image_path.stat().st_size,
                "status": "OK", "canonical": True, "sha256": "d" * 64,
                "width": 640, "height": 960, "quality_score": 70.0,
                "model_key": "Filmes / Saga / Personagem",
            }) + "\n", encoding="utf-8")

            output = root / "bundle"
            build_bundle(source, manifest, output, include_original=True)
            model = json.loads((output / "models.jsonl").read_text(encoding="utf-8").strip())
            gallery = json.loads((output / "r2" / model["galleryManifestKey"]).read_text(encoding="utf-8"))
            original_key = gallery["images"][0]["variantKeys"]["original"]
            self.assertTrue((output / "r2" / original_key).is_file())


if __name__ == "__main__":
    unittest.main()
