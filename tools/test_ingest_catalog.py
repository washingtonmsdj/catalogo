from __future__ import annotations

import tempfile
import unittest
from pathlib import Path

from PIL import Image, ImageDraw

from ingest_catalog import analyze, clean_folder, hamming, mark_duplicates


class CatalogIngestTests(unittest.TestCase):
    def test_clean_folder_removes_audit_prefix_and_count(self) -> None:
        self.assertEqual(clean_folder("OK - Games [539]"), "Games")
        self.assertEqual(clean_folder("OK - Resident Evil [32]"), "Resident Evil")

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
