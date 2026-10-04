from __future__ import annotations

import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from PIL import Image

from build_media_bundle import (
    build_bundle,
    franchise_index,
    load_taxonomy_config,
    media_build_output_lock,
    model_display_name,
    save_media_build_state,
)


class MediaBundleTests(unittest.TestCase):
    def test_public_display_name_uses_character_leaf_but_not_generic_group(self) -> None:
        self.assertEqual(
            model_display_name(
                ["Marvel & DC", "Heróis Individuais", "Homem-Aranha", "Abutre"],
                ["Homem-Aranha", "Abutre"],
                "Abutre traje verde com asas em estatua",
                True,
            ),
            "Abutre",
        )
        self.assertEqual(
            model_display_name(
                ["Marvel & DC", "Adão Negro", "Confrontos"],
                ["Confrontos"],
                "Adao negro e doutor destino",
                True,
            ),
            "Adao negro e doutor destino",
        )

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
            self.assertEqual(summary["galleryManifests"], 1)

            model_index = [json.loads(line) for line in (output / "models.jsonl").read_text(encoding="utf-8").splitlines()]
            self.assertEqual(len(model_index), 1)
            model = model_index[0]
            self.assertEqual(model["displayName"], "Heroi")
            self.assertEqual(model["categoryName"], "Games")
            self.assertEqual(model["categorySlug"], "games")
            self.assertEqual(model["franchiseName"], "Saga")
            self.assertEqual(model["franchiseSlug"], "saga")
            self.assertEqual(model["slug"], "saga-heroi")
            self.assertTrue(model["code"].startswith("TS-"))
            self.assertEqual(model["imageCount"], 2)
            self.assertRegex(model["galleryManifestKey"], rf"^gallery/{model['id']}/[0-9a-f]{{24}}\.json$")
            self.assertIsInstance(model["galleryVersion"], int)

            gallery_path = output / "r2" / model["galleryManifestKey"]
            gallery = json.loads(gallery_path.read_text(encoding="utf-8"))
            self.assertEqual(gallery["version"], model["galleryVersion"])
            self.assertEqual(len(gallery["images"]), 2)
            self.assertEqual(gallery["images"][0]["sourceSha256"], "a" * 64)
            self.assertEqual(gallery["images"][0]["role"], "cover")

            low_item = next(item for item in gallery["images"] if item["sourceSha256"] == "b" * 64)
            for variant in low_item["variants"].values():
                self.assertLessEqual(variant["width"], 300)
                self.assertLessEqual(variant["height"], 200)

    def test_gallery_manifest_key_is_deterministic_and_changes_with_gallery(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            source = root / "catalog"
            model_dir = source / "Games" / "Saga" / "Heroi"
            model_dir.mkdir(parents=True)
            first = model_dir / "first.png"
            second = model_dir / "second.png"
            Image.new("RGB", (640, 960), "#202428").save(first)
            Image.new("RGB", (640, 960), "#303438").save(second)
            manifest = root / "manifest.jsonl"

            def row(path: Path, sha: str, score: float) -> dict:
                return {
                    "path": str(path.relative_to(source)), "size": path.stat().st_size,
                    "status": "OK", "canonical": True, "sha256": sha,
                    "width": 640, "height": 960, "quality_score": score,
                    "model_key": "Games / Saga / Heroi",
                }

            manifest.write_text(json.dumps(row(first, "1" * 64, 80.0)) + "\n", encoding="utf-8")
            output_a = root / "bundle-a"
            output_b = root / "bundle-b"
            build_bundle(source, manifest, output_a, include_original=False)
            build_bundle(source, manifest, output_b, include_original=False)
            model_a = json.loads((output_a / "models.jsonl").read_text(encoding="utf-8"))
            model_b = json.loads((output_b / "models.jsonl").read_text(encoding="utf-8"))
            self.assertEqual(model_a["galleryManifestKey"], model_b["galleryManifestKey"])
            self.assertEqual(model_a["galleryVersion"], model_b["galleryVersion"])

            manifest.write_text(
                json.dumps(row(first, "1" * 64, 80.0)) + "\n" + json.dumps(row(second, "2" * 64, 70.0)) + "\n",
                encoding="utf-8",
            )
            output_c = root / "bundle-c"
            build_bundle(source, manifest, output_c, include_original=False)
            model_c = json.loads((output_c / "models.jsonl").read_text(encoding="utf-8"))
            self.assertNotEqual(model_a["galleryManifestKey"], model_c["galleryManifestKey"])
            self.assertNotEqual(model_a["galleryVersion"], model_c["galleryVersion"])

    def test_slug_collision_gets_stable_model_suffix(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            source = root / "catalog"
            paths = [
                source / "Games" / "Saga A" / "Heroi",
                source / "Games" / "Saga-A" / "Heroi",
            ]
            rows = []
            for index, model_dir in enumerate(paths):
                model_dir.mkdir(parents=True)
                image_path = model_dir / "vista.png"
                Image.new("RGB", (320, 480), f"#{index + 2}{index + 2}{index + 2}333").save(image_path)
                model_key = " / ".join(image_path.relative_to(source).parts[:-1])
                rows.append({
                    "path": str(image_path.relative_to(source)), "size": image_path.stat().st_size,
                    "status": "OK", "canonical": True, "sha256": str(index + 3) * 64,
                    "width": 320, "height": 480, "quality_score": 50.0,
                    "model_key": model_key,
                })
            manifest = root / "manifest.jsonl"
            manifest.write_text("".join(json.dumps(row) + "\n" for row in rows), encoding="utf-8")
            output = root / "bundle"
            build_bundle(source, manifest, output, include_original=False)
            models = [json.loads(line) for line in (output / "models.jsonl").read_text(encoding="utf-8").splitlines()]
            self.assertEqual(len({model["slug"] for model in models}), 2)
            self.assertTrue(all(model["slug"].startswith("saga-a-heroi-") for model in models))

    def test_audited_public_entries_remain_distinct_models(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            source = root / "catalog"
            model_dir = source / "OK - Animes & Desenhos [2]" / "OK - Animes [2]" / "OK - Dragon Ball [2]" / "OK - Androide 18 [2]"
            model_dir.mkdir(parents=True)
            first = model_dir / "androide-18-busto-display.webp"
            second = model_dir / "androide-18-traje-azul.webp"
            Image.new("RGB", (640, 960), "#223344").save(first, "WEBP")
            Image.new("RGB", (640, 960), "#334455").save(second, "WEBP")
            rows = []
            hierarchy = "Animes & Desenhos / Animes / Dragon Ball / Androide 18"
            for index, path in enumerate((first, second), 1):
                rows.append({
                    "path": str(path.relative_to(source)), "size": path.stat().st_size,
                    "status": "OK", "canonical": True, "sha256": str(index) * 64,
                    "width": 640, "height": 960, "quality_score": 70.0,
                    "model_key": hierarchy,
                    "public_model_key": f"{hierarchy} / {path.stem}",
                })
            manifest = root / "manifest.jsonl"
            manifest.write_text("".join(json.dumps(row) + "\n" for row in rows), encoding="utf-8")
            output = root / "bundle"
            summary = build_bundle(source, manifest, output, include_original=False)
            models = [json.loads(line) for line in (output / "models.jsonl").read_text(encoding="utf-8").splitlines()]
            self.assertEqual(summary["models"], 2)
            self.assertEqual(len(models), 2)
            self.assertTrue(all(model["franchiseName"] == "Dragon Ball" for model in models))
            self.assertEqual({model["imageCount"] for model in models}, {1})
            self.assertEqual({model["displayName"] for model in models}, {"Androide 18"})
            self.assertEqual(len({model["id"] for model in models}), 2)
            self.assertEqual({model["slug"] for model in models}, {"dragon-ball-androide-18-busto-display", "dragon-ball-androide-18-traje-azul"})
            self.assertTrue(any("busto display" in model["searchText"] for model in models))
            self.assertTrue(any("traje azul" in model["searchText"] for model in models))

    def test_explicit_taxonomy_override_creates_nested_villain_folder(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            source = root / "catalog"
            model_dir = source / "OK - Animes & Desenhos [1]" / "OK - Clássicos [1]" / "OK - As Tartarugas Ninja [1]" / "OK - Destruidor [1]"
            model_dir.mkdir(parents=True)
            image_path = model_dir / "destruidor-01.jpg"
            Image.new("RGB", (640, 960), "#223344").save(image_path)
            hierarchy = "Animes & Desenhos / Clássicos / As Tartarugas Ninja / Destruidor"
            row = {
                "path": str(image_path.relative_to(source)), "size": image_path.stat().st_size,
                "status": "OK", "canonical": True, "sha256": "e" * 64,
                "width": 640, "height": 960, "quality_score": 70.0,
                "model_key": hierarchy, "public_model_key": f"{hierarchy} / {image_path.stem}",
            }
            manifest = root / "manifest.jsonl"
            manifest.write_text(json.dumps(row) + "\n", encoding="utf-8")
            output = root / "bundle"
            build_bundle(source, manifest, output, include_original=False)
            model = json.loads((output / "models.jsonl").read_text(encoding="utf-8"))
            self.assertEqual(model["franchiseName"], "As Tartarugas Ninja")
            self.assertEqual(model["folderPath"], ["Vilões", "Destruidor"])
            self.assertEqual(model["folderPathKey"], "viloes/destruidor")
            self.assertEqual(model["collection"], "Vilões / Destruidor")
            self.assertEqual(model["displayName"], "Destruidor")
            self.assertIn("vilões", model["searchText"])
            self.assertIn("destruidor 01", model["searchText"])
            self.assertTrue(model["slug"].startswith("as-tartarugas-ninja-destruidor-01"))

    def test_tmnt_hero_stays_at_franchise_root(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            source = root / "catalog"
            model_dir = source / "OK - Animes & Desenhos [1]" / "OK - Clássicos [1]" / "OK - As Tartarugas Ninja [1]" / "OK - Leonardo [1]"
            model_dir.mkdir(parents=True)
            image_path = model_dir / "leonardo-01.jpg"
            Image.new("RGB", (640, 960), "#335577").save(image_path)
            hierarchy = "Animes & Desenhos / Clássicos / As Tartarugas Ninja / Leonardo"
            row = {
                "path": str(image_path.relative_to(source)), "size": image_path.stat().st_size,
                "status": "OK", "canonical": True, "sha256": "f" * 64,
                "width": 640, "height": 960, "quality_score": 70.0,
                "model_key": hierarchy, "public_model_key": f"{hierarchy} / {image_path.stem}",
            }
            manifest = root / "manifest.jsonl"
            manifest.write_text(json.dumps(row) + "\n", encoding="utf-8")
            output = root / "bundle"
            build_bundle(source, manifest, output, include_original=False)
            model = json.loads((output / "models.jsonl").read_text(encoding="utf-8"))
            self.assertEqual(model["folderPath"], ["Leonardo"])
            self.assertEqual(model["folderPathKey"], "leonardo")
            self.assertEqual(model["collection"], "Leonardo")
            self.assertEqual(model["displayName"], "Leonardo")
            self.assertIn("leonardo 01", model["searchText"])

    def test_taxonomy_config_rejects_unsafe_public_segments(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            config = Path(tmp) / "taxonomy.json"
            config.write_text(json.dumps({
                "version": 1,
                "franchises": {
                    "animes-desenhos/as-tartarugas-ninja": {
                        "pathOverrides": {
                            "Destruidor": ["Vilões", ".."]
                        }
                    }
                }
            }), encoding="utf-8")

            with self.assertRaisesRegex(RuntimeError, "segmento público inválido"):
                load_taxonomy_config(config)

    def test_source_hierarchy_rules_come_from_taxonomy_config(self) -> None:
        taxonomy = load_taxonomy_config()
        self.assertEqual(
            franchise_index(["Animes & Desenhos", "Clássicos", "As Tartarugas Ninja", "Leonardo"], taxonomy),
            2,
        )
        self.assertEqual(
            franchise_index(["Filmes & Séries", "01 - Ficção", "Alien", "Xenomorfo"], taxonomy),
            2,
        )
        self.assertEqual(
            franchise_index(["Games", "00 - Fliperama", "Street Fighter", "Ryu"], taxonomy),
            2,
        )

    def test_source_hierarchy_has_no_implicit_hardcoded_grouping(self) -> None:
        taxonomy = {"version": 1, "franchises": {}}
        self.assertEqual(
            franchise_index(["Animes & Desenhos", "Clássicos", "As Tartarugas Ninja", "Leonardo"], taxonomy),
            1,
        )

    def test_taxonomy_path_group_adds_public_parent_without_moving_other_members(self) -> None:
        taxonomy = {
            "version": 1,
            "franchises": {
                "animes-desenhos/as-tartarugas-ninja": {
                    "pathGroups": {"Vilões": ["Destruidor"]}
                }
            },
        }
        from build_media_bundle import public_folder_path
        self.assertEqual(
            public_folder_path("animes-desenhos", "as-tartarugas-ninja", ["Destruidor"], taxonomy),
            ["Vilões", "Destruidor"],
        )
        self.assertEqual(
            public_folder_path("animes-desenhos", "as-tartarugas-ninja", ["Leonardo"], taxonomy),
            ["Leonardo"],
        )

    def test_taxonomy_config_rejects_source_in_multiple_public_groups(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            config = Path(tmp) / "taxonomy.json"
            config.write_text(json.dumps({
                "version": 1,
                "franchises": {
                    "animes-desenhos/as-tartarugas-ninja": {
                        "pathGroups": {
                            "Vilões": ["Destruidor"],
                            "Chefes": ["Destruidor"],
                        }
                    }
                },
            }), encoding="utf-8")
            with self.assertRaisesRegex(RuntimeError, "múltiplos grupos"):
                load_taxonomy_config(config)

    def test_taxonomy_config_rejects_invalid_source_hierarchy_regex(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            config = Path(tmp) / "taxonomy.json"
            config.write_text(json.dumps({
                "version": 1,
                "sourceHierarchy": {
                    "categoryIntermediates": {
                        "filmes-series": {"pattern": "["}
                    }
                },
                "franchises": {},
            }), encoding="utf-8")
            with self.assertRaisesRegex(RuntimeError, "pattern regex inválido"):
                load_taxonomy_config(config)

    def test_parallel_workers_keep_deterministic_model_index(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            source = root / "catalog"
            rows = []
            for index, hero in enumerate(("Heroi A", "Heroi B"), 1):
                model_dir = source / "Games" / "Saga" / hero
                model_dir.mkdir(parents=True)
                image_path = model_dir / "vista.png"
                Image.new("RGB", (640, 960), f"#{index}{index}3344").save(image_path)
                rows.append({
                    "path": str(image_path.relative_to(source)), "size": image_path.stat().st_size,
                    "status": "OK", "canonical": True, "sha256": str(index) * 64,
                    "width": 640, "height": 960, "quality_score": 70.0,
                    "model_key": f"Games / Saga / {hero}",
                })
            manifest = root / "manifest.jsonl"
            manifest.write_text("".join(json.dumps(row) + "\n" for row in rows), encoding="utf-8")

            output_single = root / "single"
            output_parallel = root / "parallel"
            build_bundle(source, manifest, output_single, include_original=False, workers=1)
            build_bundle(source, manifest, output_parallel, include_original=False, workers=3)

            self.assertEqual(
                (output_single / "models.jsonl").read_text(encoding="utf-8"),
                (output_parallel / "models.jsonl").read_text(encoding="utf-8"),
            )

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

    def test_media_build_output_lock_blocks_concurrent_bundle_writer(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            output = Path(tmp) / "bundle"
            with media_build_output_lock(output):
                with self.assertRaisesRegex(RuntimeError, "já está em execução"):
                    build_bundle(
                        Path(tmp) / "missing-source",
                        Path(tmp) / "missing-manifest.jsonl",
                        output,
                        include_original=False,
                    )
                self.assertFalse((output / "media-build-state.json").exists())

            with media_build_output_lock(output):
                self.assertTrue((output / ".media-build.lock").is_file())

    def test_media_build_state_retries_transient_windows_lock(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "media-build-state.json"
            original_replace = Path.replace
            attempts = {"count": 0}

            def flaky_replace(source: Path, target: Path):
                attempts["count"] += 1
                if attempts["count"] < 3:
                    raise PermissionError("arquivo temporariamente bloqueado")
                return original_replace(source, target)

            with patch.object(Path, "replace", flaky_replace), patch("build_media_bundle.time.sleep"):
                save_media_build_state(path, {"version": 1, "models": {"mdl": {}}})

            self.assertEqual(attempts["count"], 3)
            self.assertEqual(json.loads(path.read_text(encoding="utf-8"))["version"], 1)
            self.assertFalse(path.with_suffix(path.suffix + ".tmp").exists())

    def test_media_build_state_fails_closed_when_lock_persists(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "media-build-state.json"
            with patch.object(Path, "replace", side_effect=PermissionError("lock persistente")), patch("build_media_bundle.time.sleep"):
                with self.assertRaises(PermissionError):
                    save_media_build_state(path, {"version": 1, "models": {}})

            self.assertFalse(path.exists())
            self.assertTrue(path.with_suffix(path.suffix + ".tmp").exists())

    def test_media_build_resume_reuses_verified_outputs(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            source = root / "catalog"
            model_dir = source / "Games" / "Saga" / "Heroi"
            model_dir.mkdir(parents=True)
            image_path = model_dir / "vista.png"
            Image.new("RGB", (640, 960), "#445566").save(image_path)
            manifest = root / "manifest.jsonl"
            manifest.write_text(json.dumps({
                "path": str(image_path.relative_to(source)), "size": image_path.stat().st_size,
                "status": "OK", "canonical": True, "sha256": "9" * 64,
                "width": 640, "height": 960, "quality_score": 70.0,
                "model_key": "Games / Saga / Heroi",
            }) + "\n", encoding="utf-8")
            output = root / "bundle"

            first = build_bundle(source, manifest, output, include_original=False, workers=1)
            index_before = (output / "models.jsonl").read_text(encoding="utf-8")
            second = build_bundle(source, manifest, output, include_original=False, workers=1)

            self.assertEqual(first["builtModels"], 1)
            self.assertEqual(first["resumedModels"], 0)
            self.assertEqual(second["builtModels"], 0)
            self.assertEqual(second["resumedModels"], 1)
            self.assertEqual((output / "models.jsonl").read_text(encoding="utf-8"), index_before)
            self.assertTrue((output / "media-build-state.json").is_file())

    def test_media_build_resume_rebuilds_when_cached_output_is_missing(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            source = root / "catalog"
            model_dir = source / "Games" / "Saga" / "Heroi"
            model_dir.mkdir(parents=True)
            image_path = model_dir / "vista.png"
            Image.new("RGB", (640, 960), "#556677").save(image_path)
            manifest = root / "manifest.jsonl"
            manifest.write_text(json.dumps({
                "path": str(image_path.relative_to(source)), "size": image_path.stat().st_size,
                "status": "OK", "canonical": True, "sha256": "8" * 64,
                "width": 640, "height": 960, "quality_score": 70.0,
                "model_key": "Games / Saga / Heroi",
            }) + "\n", encoding="utf-8")
            output = root / "bundle"

            build_bundle(source, manifest, output, include_original=False, workers=1)
            model = json.loads((output / "models.jsonl").read_text(encoding="utf-8"))
            cover = output / "r2" / model["coverStorageKey"]
            cover.unlink()

            resumed = build_bundle(source, manifest, output, include_original=False, workers=1)

            self.assertEqual(resumed["builtModels"], 1)
            self.assertEqual(resumed["resumedModels"], 0)
            self.assertTrue(cover.is_file())


if __name__ == "__main__":
    unittest.main()
