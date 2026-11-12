from __future__ import annotations

import csv
import json
import tempfile
import unittest
from pathlib import Path

from apply_catalog_editorial_review import HEADERS, apply_review


def model(model_id: str, name: str, *, variant: str = "") -> dict:
    return {
        "id": model_id, "slug": "slug-" + model_id[-1],
        "code": "TS-" + model_id[-8:].upper(), "displayName": name,
        "variantName": variant, "categoryName": "Filmes",
        "categorySlug": "filmes", "franchiseName": "Classicos",
        "franchiseSlug": "classicos", "collection": "Colecao",
        "folderPath": ["Colecao"], "folderPathKey": "colecao",
        "published": 1,
    }


class EditorialReviewTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.contract = self.root / "catalog-production-model-contract.json"
        self.review = self.root / "revisao.csv"
        self.models = [
            model("mdl_11111111111111111111", "Heroi", variant="Classico"),
            model("mdl_22222222222222222222", "Vilao", variant="Edição"),
        ]
        self.contract.write_text(json.dumps({
            "version": 1, "source": {"productionModels": 2, "publishedModels": 2},
            "models": self.models,
        }, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")

    def row(self, m, new_name="", new_variant=""):
        return {
            "ID canônico": m["id"], "Slug": m["slug"], "Código": m["code"],
            "Modelo": m["displayName"], "Variante": m["variantName"],
            "Categoria": m["categoryName"], "Franquia": m["franchiseName"],
            "Imagens declaradas": "3", "Chave da capa": "media/test/card.webp",
            "Estado da capa": "Chave cadastrada; entrega não verificada",
            "Novo nome": new_name, "Nova variante": new_variant,
        }

    def write_review(self, rows, headers=HEADERS):
        with self.review.open("w", encoding="utf-8-sig", newline="") as handle:
            writer = csv.DictWriter(handle, fieldnames=headers, delimiter=";")
            writer.writeheader()
            writer.writerows(rows)

    def test_dry_run_does_not_change_ssot(self):
        self.write_review([self.row(self.models[0], new_name="Heroi Especial")])
        original = self.contract.read_bytes()
        result = apply_review(self.review, self.contract)
        self.assertEqual(result["changed"], 1)
        self.assertFalse(result["applied"])
        self.assertEqual(self.contract.read_bytes(), original)

    def test_apply_only_changes_approved_public_fields(self):
        self.write_review([self.row(self.models[0], "Heroi Atualizado", "Edição Limitada")])
        before = self.contract.read_text(encoding="utf-8")
        result = apply_review(self.review, self.contract, apply=True)
        after = self.contract.read_text(encoding="utf-8")
        self.assertTrue(result["applied"])
        self.assertEqual(result["changed"], 1)
        parsed = json.loads(after)["models"]
        self.assertEqual(parsed[0]["displayName"], "Heroi Atualizado")
        self.assertEqual(parsed[0]["variantName"], "Edição Limitada")
        self.assertEqual(parsed[0]["slug"], self.models[0]["slug"])
        self.assertEqual(parsed[0]["code"], self.models[0]["code"])
        self.assertEqual(parsed[1], self.models[1])
        self.assertEqual(before.count('"id":'), after.count('"id":'))
        self.assertIn('      "id": "mdl_22222222222222222222"', after)

    def test_rejects_stale_csv_without_mutation(self):
        row = self.row(self.models[0], new_name="Novo")
        row["Modelo"] = "Outro nome antigo"
        self.write_review([row])
        original = self.contract.read_bytes()
        with self.assertRaisesRegex(ValueError, "stale_snapshot"):
            apply_review(self.review, self.contract, apply=True)
        self.assertEqual(self.contract.read_bytes(), original)

    def test_rejects_editing_retired_or_unknown_model(self):
        row = self.row(self.models[0], new_name="Novo")
        row["ID canônico"] = "mdl_33333333333333333333"
        self.write_review([row])
        with self.assertRaisesRegex(ValueError, "not_in_published_contract"):
            apply_review(self.review, self.contract, apply=True)

    def test_untouched_newer_or_stale_rows_do_not_block_an_exact_edit(self):
        newer = self.row(self.models[0])
        newer["ID canônico"] = "mdl_33333333333333333333"
        newer["Modelo"] = "Nome novo que não está no contrato"
        second = self.row(self.models[1], new_name="Vilao Atualizado")
        self.write_review([newer, second])
        result = apply_review(self.review, self.contract, apply=True)
        self.assertEqual(result["changed"], 1)
        self.assertEqual(json.loads(self.contract.read_text(encoding="utf-8"))["models"][1]["displayName"], "Vilao Atualizado")

    def test_rejects_duplicate_rows(self):
        row = self.row(self.models[0], new_name="Novo")
        self.write_review([row, row])
        with self.assertRaisesRegex(ValueError, "duplicate_or_invalid_id"):
            apply_review(self.review, self.contract, apply=True)

    def test_rejects_csv_formula_and_markup(self):
        for candidate in ('=HYPERLINK("https://x")', "@SUM(1)", "<script>", "\tindesejado"):
            self.write_review([self.row(self.models[0], new_name=candidate)])
            with self.assertRaisesRegex(ValueError, "invalid_editorial_label"):
                apply_review(self.review, self.contract, apply=True)

    def test_refuses_unknown_or_missing_columns(self):
        self.write_review([{key: value for key, value in self.row(self.models[0]).items() if key in HEADERS[:-1]}], headers=HEADERS[:-1])
        with self.assertRaises(ValueError):
            apply_review(self.review, self.contract)

    def test_no_change_preserves_byte_identical_source(self):
        self.write_review([self.row(self.models[0])])
        original = self.contract.read_bytes()
        result = apply_review(self.review, self.contract, apply=True)
        self.assertEqual(result["changed"], 0)
        self.assertFalse(result["applied"])
        self.assertEqual(self.contract.read_bytes(), original)

    def test_collision_blocked_without_mutation(self):
        row = self.row(self.models[0], new_name="Vilao", new_variant="Edição")
        self.write_review([row])
        original = self.contract.read_bytes()
        with self.assertRaisesRegex(ValueError, "public_name_collision"):
            apply_review(self.review, self.contract, apply=True)
        self.assertEqual(original, self.contract.read_bytes())

    def test_oversized_page_refused(self):
        self.write_review([self.row(self.models[0])] * 13)
        with self.assertRaisesRegex(ValueError, "page_size_invalid"):
            apply_review(self.review, self.contract)

    def test_no_media_or_identity_field_is_accepted_for_editing(self):
        row = self.row(self.models[0], new_name="Novo")
        row["Novo slug"] = "outro"
        self.write_review([row], headers=(*HEADERS, "Novo slug"))
        with self.assertRaisesRegex(ValueError, "headers_mismatch"):
            apply_review(self.review, self.contract, apply=True)


if __name__ == "__main__":
    unittest.main()
