from __future__ import annotations

import tempfile
import unittest
from pathlib import Path

from PIL import Image, ImageDraw

from ingest_catalog import analyze, clean_folder, discover_catalog_roots, disambiguate_public_model_keys, hamming, iter_images, load_audit_registry, mark_duplicates, save_progress_manifest


class CatalogIngestTests(unittest.TestCase):
    def test_clean_folder_removes_audit_prefix_and_count(self) -> None:
        self.assertEqual(clean_folder("OK - Games [539]"), "Games")
        self.assertEqual(clean_folder("OK - Resident Evil [32]"), "Resident Evil")

    def test_discovery_only_selects_audited_top_level_categories(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            active = root / "OK - Games [1]"
            stats = root / "00 - ESTATISTICAS - CATALOGO [1]"
            incoming = root / "Novos"
            consolidated = root / "99 - LOTES CONSOLIDADOS"
            for folder in (active, stats, incoming, consolidated):
                folder.mkdir(parents=True)
                Image.new("RGB", (32, 32), "white").save(folder / "sample.png")

            self.assertEqual(discover_catalog_roots(root), [active])
            self.assertEqual(list(iter_images(root)), [active / "sample.png"])

    def test_discovery_fails_closed_without_audited_categories(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            (root / "Novos").mkdir()
            with self.assertRaisesRegex(RuntimeError, "nenhuma categoria ativa"):
                list(iter_images(root))

    def test_audit_registry_is_explicit_and_fail_closed(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            active = root / "OK - Games [1]" / "OK - Saga [1]"
            active.mkdir(parents=True)
            image_path = active / "hero.png"
            Image.new("RGB", (64, 64), "white").save(image_path)
            import hashlib
            digest = hashlib.sha256(image_path.read_bytes()).hexdigest()
            registry = root / "audit.csv"
            registry.write_text(
                "codigo,sha256,caminho,status\n"
                f"AUD-1,{digest},OK - Games [1]\\OK - Saga [1]\\hero.png,OK_VISUAL|RV1\n",
                encoding="utf-8-sig",
            )

            paths, hashes, metadata = load_audit_registry(root, registry)

            self.assertEqual(paths, [image_path])
            self.assertEqual(hashes[str(image_path.relative_to(root))], digest)
            self.assertEqual(metadata[str(image_path.relative_to(root))]["codigo"], "AUD-1")

    def test_audit_registry_rejects_operational_paths(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            operational = root / "99 - LOTES CONSOLIDADOS"
            operational.mkdir()
            image_path = operational / "duplicate.png"
            Image.new("RGB", (64, 64), "white").save(image_path)
            registry = root / "audit.csv"
            registry.write_text(
                "sha256,caminho\n"
                + ("0" * 64)
                + ",99 - LOTES CONSOLIDADOS\\duplicate.png\n",
                encoding="utf-8-sig",
            )

            with self.assertRaisesRegex(RuntimeError, "fora de categoria auditada"):
                load_audit_registry(root, registry)

    def test_progress_checkpoint_is_atomic_and_resumable(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            target = root / "OK - Games [1]" / "OK - Saga [1]" / "OK - Heroi [1]"
            target.mkdir(parents=True)
            path = target / "hero.png"
            Image.new("RGB", (64, 64), "white").save(path)
            record = analyze(root, path)
            record.duplicate_group = "visual-000001"
            record.canonical = False
            output = root / "checkpoint"

            save_progress_manifest(output, [record])

            manifest = output / "manifest.jsonl"
            self.assertTrue(manifest.exists())
            self.assertFalse((output / "manifest.jsonl.tmp").exists())
            row = __import__("json").loads(manifest.read_text(encoding="utf-8"))
            self.assertIsNone(row["duplicate_group"])
            self.assertTrue(row["canonical"])

    def test_analysis_preserves_hierarchy_and_hashes(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            target = root / "OK - Games [2]" / "OK - Saga [2]" / "OK - Heroi [2]"
            target.mkdir(parents=True)
            path = target / "frente.png"
            Image.new("RGB", (1200, 1600), "#6d5542").save(path)

            record = analyze(root, path)

            self.assertEqual(record.status, "OK")
            self.assertEqual(record.category, "Games")
            self.assertEqual(record.franchise, "Saga")
            self.assertEqual(record.model_key, "Games / Saga / Heroi")
            self.assertEqual(record.width, 1200)
            self.assertEqual(record.height, 1600)
            self.assertEqual(len(record.sha256 or ""), 64)
            self.assertEqual(len(record.dhash or ""), 16)
            self.assertIsNotNone(record.quality_score)

    def test_audited_same_stem_models_are_disambiguated_only_on_collision(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            target = root / "OK - Animes [2]" / "OK - Dragon Ball [2]" / "OK - Goku [2]"
            target.mkdir(parents=True)
            first = target / "legacy-goku-(1).jpg"
            second = target / "legacy-goku-(1).png"
            Image.new("RGB", (320, 480), "#223344").save(first)
            Image.new("RGB", (320, 480), "#334455").save(second)
            records = [analyze(root, first), analyze(root, second)]
            for index, record in enumerate(records, 1):
                record.public_model_key = f"{record.model_key} / legacy-goku-(1)"
                record.audit_code = f"AUD-{index}"

            disambiguate_public_model_keys(records)

            self.assertEqual(len({record.public_model_key for record in records}), 2)
            self.assertTrue(records[0].public_model_key.endswith("/ AUD-1"))
            self.assertTrue(records[1].public_model_key.endswith("/ AUD-2"))

    def test_exact_duplicates_are_grouped_without_deleting_source(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            target = root / "OK - Games [2]" / "OK - Saga [2]" / "OK - Heroi [2]"
            target.mkdir(parents=True)
            first = target / "a.png"
            second = target / "b.png"
            image = Image.new("RGB", (900, 1200), "#2f3438")
            image.save(first)
            second.write_bytes(first.read_bytes())

            records = [analyze(root, first), analyze(root, second)]
            groups = mark_duplicates(records, visual_threshold=6)

            self.assertEqual(len(groups), 1)
            self.assertEqual(groups[0]["kind"], "exact")
            self.assertEqual(sum(record.canonical for record in records), 1)
            self.assertTrue(first.exists())
            self.assertTrue(second.exists())

    def test_exact_same_file_in_different_models_is_preserved_for_both(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            first_dir = root / "OK - Games [2]" / "OK - Saga [2]" / "OK - Heroi A [1]"
            second_dir = root / "OK - Games [2]" / "OK - Saga [2]" / "OK - Heroi B [1]"
            first_dir.mkdir(parents=True)
            second_dir.mkdir(parents=True)
            first = first_dir / "diorama.png"
            second = second_dir / "diorama.png"
            Image.new("RGB", (1000, 1400), "#4c5560").save(first)
            second.write_bytes(first.read_bytes())

            records = [analyze(root, first), analyze(root, second)]
            self.assertEqual(records[0].sha256, records[1].sha256)
            self.assertNotEqual(records[0].model_key, records[1].model_key)

            groups = mark_duplicates(records, visual_threshold=6)

            self.assertEqual(groups, [])
            self.assertTrue(all(record.canonical for record in records))

    def test_visual_candidates_prefer_higher_quality_version(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            target = root / "OK - Animes [2]" / "OK - Serie [2]" / "OK - Heroina [2]"
            target.mkdir(parents=True)

            small = target / "vista-small.jpg"
            large = target / "vista-large.png"
            for path, size in ((small, (640, 800)), (large, (1600, 2000))):
                image = Image.new("RGB", size, "white")
                draw = ImageDraw.Draw(image)
                draw.rectangle((size[0] // 4, size[1] // 5, size[0] * 3 // 4, size[1] * 4 // 5), fill="#34393e")
                draw.ellipse((size[0] // 3, size[1] // 8, size[0] * 2 // 3, size[1] // 3), fill="#c19d79")
                image.save(path)

            records = [analyze(root, small), analyze(root, large)]
            self.assertLessEqual(hamming(records[0].dhash or "0", records[1].dhash or "0"), 6)
            groups = mark_duplicates(records, visual_threshold=6)

            self.assertEqual(len(groups), 1)
            self.assertEqual(groups[0]["kind"], "visual_candidate")
            self.assertEqual(groups[0]["canonical"], str(large.relative_to(root)))
            self.assertTrue(small.exists())
            self.assertTrue(large.exists())


if __name__ == "__main__":
    unittest.main()
