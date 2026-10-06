from __future__ import annotations

import json
import tempfile
import unittest
from pathlib import Path

from publish_d1 import load_models, validate_r2_ready
from publish_r2 import default_state, discover, save_state


def model() -> dict:
    return {
        "id": "mdl-1",
        "slug": "android-18",
        "code": "TS-1",
        "displayName": "Androide 18",
        "categoryName": "Animes & Desenhos",
        "categorySlug": "animes-desenhos",
        "franchiseName": "Dragon Ball",
        "franchiseSlug": "dragon-ball",
        "collection": "Androides / Androide 18",
        "folderPath": ["Androides", "Androide 18"],
        "folderPathKey": "androides/androide-18",
        "searchText": "dragon ball androide 18",
        "imageCount": 1,
        "coverStorageKey": "media/mdl-1/img-1/card.webp",
        "galleryManifestKey": "gallery/mdl-1/manifest.json",
        "galleryVersion": 1,
    }


class PublishReadinessTests(unittest.TestCase):
    def make_bundle(self, root: Path, *, manifest_model_id: str = "mdl-1") -> tuple[Path, list[dict]]:
        bundle = root / "bundle"
        r2 = bundle / "r2"
        media = r2 / "media" / "mdl-1" / "img-1"
        gallery = r2 / "gallery" / "mdl-1"
        media.mkdir(parents=True)
        gallery.mkdir(parents=True)
        (media / "thumb.webp").write_bytes(b"thumb")
        (media / "card.webp").write_bytes(b"card")
        (media / "detail.webp").write_bytes(b"detail")
        manifest = {
            "modelId": manifest_model_id,
            "images": [
                {
                    "variantKeys": {
                        "thumb": "media/mdl-1/img-1/thumb.webp",
                        "card": "media/mdl-1/img-1/card.webp",
                        "detail": "media/mdl-1/img-1/detail.webp",
                    }
                }
            ],
        }
        (gallery / "manifest.json").write_text(json.dumps(manifest), encoding="utf-8")
        models_path = bundle / "models.jsonl"
        models_path.write_text(json.dumps(model()) + "\n", encoding="utf-8")
        return models_path, load_models(models_path)

    def write_complete_state(self, models_path: Path) -> Path:
        r2 = models_path.parent / "r2"
        state_path = models_path.parent / "r2-publish-state.json"
        state = default_state()
        for candidate in discover(r2, state):
            state["objects"][candidate.key] = {
                "size": candidate.size,
                "mtime_ns": candidate.mtime_ns,
                "sha256": candidate.sha256,
                "published_sha256": candidate.sha256,
            }
        save_state(state_path, state)
        return state_path

    def test_complete_r2_checkpoint_allows_d1_gate(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            models_path, rows = self.make_bundle(Path(tmp))
            state_path = self.write_complete_state(models_path)

            result = validate_r2_ready(models_path, rows, state_path)

            self.assertTrue(result["ready"])
            self.assertEqual(result["objects"], 4)
            self.assertEqual(result["requiredKeys"], 4)

    def test_multi_image_gallery_requires_matching_count_and_all_variants(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            models_path, _ = self.make_bundle(Path(tmp))
            r2 = models_path.parent / "r2"
            second_media = r2 / "media" / "mdl-1" / "img-2"
            second_media.mkdir(parents=True)
            (second_media / "thumb.webp").write_bytes(b"thumb-2")
            (second_media / "card.webp").write_bytes(b"card-2")
            (second_media / "detail.webp").write_bytes(b"detail-2")

            manifest_path = r2 / "gallery" / "mdl-1" / "manifest.json"
            manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
            manifest["images"].append({
                "variantKeys": {
                    "thumb": "media/mdl-1/img-2/thumb.webp",
                    "card": "media/mdl-1/img-2/card.webp",
                    "detail": "media/mdl-1/img-2/detail.webp",
                }
            })
            manifest_path.write_text(json.dumps(manifest), encoding="utf-8")

            row = model()
            row["imageCount"] = 2
            models_path.write_text(json.dumps(row) + "\n", encoding="utf-8")
            rows = load_models(models_path)
            state_path = self.write_complete_state(models_path)

            result = validate_r2_ready(models_path, rows, state_path)
            self.assertTrue(result["ready"])
            self.assertEqual(result["objects"], 7)
            self.assertEqual(result["requiredKeys"], 7)

            (second_media / "detail.webp").unlink()
            with self.assertRaisesRegex(RuntimeError, "bundle R2 incompleto"):
                validate_r2_ready(models_path, rows, state_path)

    def test_multi_image_gallery_rejects_manifest_count_mismatch(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            models_path, _ = self.make_bundle(Path(tmp))
            row = model()
            row["imageCount"] = 2
            models_path.write_text(json.dumps(row) + "\n", encoding="utf-8")
            rows = load_models(models_path)
            state_path = self.write_complete_state(models_path)

            with self.assertRaisesRegex(RuntimeError, "quantidade de imagens divergente"):
                validate_r2_ready(models_path, rows, state_path)

    def test_partial_checkpoint_blocks_d1_gate(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            models_path, rows = self.make_bundle(Path(tmp))
            state_path = self.write_complete_state(models_path)
            state = json.loads(state_path.read_text(encoding="utf-8"))
            state["objects"]["media/mdl-1/img-1/detail.webp"].pop("published_sha256")
            state_path.write_text(json.dumps(state), encoding="utf-8")

            with self.assertRaisesRegex(RuntimeError, "R2 ainda não está pronto"):
                validate_r2_ready(models_path, rows, state_path)

    def test_manifest_reference_missing_from_bundle_blocks_gate(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            models_path, rows = self.make_bundle(Path(tmp))
            state_path = self.write_complete_state(models_path)
            (models_path.parent / "r2" / "media" / "mdl-1" / "img-1" / "detail.webp").unlink()

            with self.assertRaisesRegex(RuntimeError, "bundle R2 incompleto"):
                validate_r2_ready(models_path, rows, state_path)

    def test_manifest_for_another_model_blocks_gate(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            models_path, rows = self.make_bundle(Path(tmp), manifest_model_id="mdl-other")
            state_path = self.write_complete_state(models_path)

            with self.assertRaisesRegex(RuntimeError, "manifesto pertence a outro modelo"):
                validate_r2_ready(models_path, rows, state_path)


if __name__ == "__main__":
    unittest.main()
