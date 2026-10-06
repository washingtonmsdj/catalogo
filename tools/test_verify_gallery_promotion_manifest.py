import tempfile
import unittest
from pathlib import Path

from build_gallery_promotion_manifest import build_promotion_rows, write_csv
from verify_gallery_promotion_manifest import read_promotion_csv, verify_manifest


def incoming(path: str, sha: str) -> dict:
    return {
        "path": path,
        "sha256": sha,
        "dhash": "0000000000000000",
        "qualityScore": 90.0,
        "width": 1200,
        "height": 1800,
        "bytes": 123456,
    }


def existing_row(model: str, sha: str) -> dict:
    return {
        "path": "catalogo/frente.jpg",
        "status": "OK",
        "canonical": True,
        "sha256": sha,
        "dhash": "0000000000000000",
        "quality_score": 80.0,
        "width": 800,
        "height": 1200,
        "size": 100000,
        "model_key": "Games / Saga / Heroi",
        "public_model_key": model,
    }


def resolution_for(path: str, sha: str) -> dict:
    return {
        "version": 1,
        "ready": True,
        "promotions": [{
            "model": "Games / Saga / Heroi / modelo-01",
            "sourceModel": "fonte / produto-01",
            "incoming": incoming(path, sha),
            "mode": "add_view",
            "replaceSha256": None,
        }],
        "keptExisting": [],
        "skippedExact": [],
    }


class VerifyGalleryPromotionManifestTests(unittest.TestCase):
    def test_manifest_matches_exact_resolution(self):
        resolution = resolution_for("produto/costas.jpg", "a" * 64)
        rows, summary = build_promotion_rows(resolution)

        result = verify_manifest(resolution, rows)

        self.assertTrue(result["ready"])
        self.assertEqual(result["resolutionSha256"], summary["resolutionSha256"])
        self.assertEqual(result["authorizations"], 1)
        self.assertEqual(result["verifiedSources"], 0)

    def test_tampered_authorization_is_rejected(self):
        resolution = resolution_for("produto/costas.jpg", "a" * 64)
        rows, _ = build_promotion_rows(resolution)
        rows[0] = dict(rows[0])
        rows[0]["target_model"] = "Games / Outra Saga / modelo-99"

        with self.assertRaisesRegex(RuntimeError, "autorização alterada"):
            verify_manifest(resolution, rows)

    def test_manifest_from_old_resolution_is_rejected(self):
        old = resolution_for("produto/costas.jpg", "a" * 64)
        current = resolution_for("produto/costas.jpg", "a" * 64)
        current["keptExisting"] = [{"note": "nova revisão"}]
        old_rows, _ = build_promotion_rows(old)

        with self.assertRaisesRegex(RuntimeError, "autorizações divergentes"):
            verify_manifest(current, old_rows)

    def test_source_bytes_are_rehashed_before_copy(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            source = root / "produto" / "costas.jpg"
            source.parent.mkdir(parents=True)
            source.write_bytes(b"conteudo-autorizado")
            import hashlib
            digest = hashlib.sha256(source.read_bytes()).hexdigest()
            resolution = resolution_for("produto/costas.jpg", digest)
            rows, _ = build_promotion_rows(resolution)

            result = verify_manifest(resolution, rows, source_root=root)
            self.assertEqual(result["verifiedSources"], 1)

            source.write_bytes(b"conteudo-alterado")
            with self.assertRaisesRegex(RuntimeError, "SHA da origem divergente"):
                verify_manifest(resolution, rows, source_root=root)

    def test_source_path_cannot_escape_authorized_root(self):
        resolution = resolution_for("../fora.jpg", "a" * 64)
        rows, _ = build_promotion_rows(resolution)

        with tempfile.TemporaryDirectory() as tmp:
            with self.assertRaisesRegex(RuntimeError, "source_path inseguro"):
                verify_manifest(resolution, rows, source_root=Path(tmp))

    def test_replace_target_is_revalidated_against_current_catalog_manifest(self):
        model = "Games / Saga / Heroi / modelo-01"
        replacement_sha = "c" * 64
        resolution = {
            "version": 1,
            "ready": True,
            "promotions": [{
                "model": model,
                "sourceModel": "fonte / produto-01",
                "incoming": incoming("produto/frente-hq.png", "b" * 64),
                "mode": "replace_existing",
                "replaceSha256": replacement_sha,
            }],
            "keptExisting": [],
            "skippedExact": [],
        }
        rows, _ = build_promotion_rows(resolution)

        result = verify_manifest(
            resolution,
            rows,
            existing_rows=[existing_row(model, replacement_sha)],
        )

        self.assertEqual(result["verifiedReplaceTargets"], 1)
        self.assertTrue(result["existingManifestVerificationRequested"])

    def test_replace_target_missing_from_current_catalog_fails_closed(self):
        model = "Games / Saga / Heroi / modelo-01"
        resolution = {
            "version": 1,
            "ready": True,
            "promotions": [{
                "model": model,
                "sourceModel": "fonte / produto-01",
                "incoming": incoming("produto/frente-hq.png", "b" * 64),
                "mode": "replace_existing",
                "replaceSha256": "c" * 64,
            }],
            "keptExisting": [],
            "skippedExact": [],
        }
        rows, _ = build_promotion_rows(resolution)

        with self.assertRaisesRegex(RuntimeError, "não existe mais no catálogo atual"):
            verify_manifest(
                resolution,
                rows,
                existing_rows=[existing_row(model, "d" * 64)],
            )

    def test_csv_roundtrip_preserves_exact_contract(self):
        resolution = resolution_for("produto/costas.jpg", "a" * 64)
        rows, _ = build_promotion_rows(resolution)

        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "promotions.csv"
            write_csv(path, rows)
            loaded = read_promotion_csv(path)
            self.assertEqual(loaded, rows)


if __name__ == "__main__":
    unittest.main()
