from __future__ import annotations

import json
import sqlite3
import tempfile
import unittest
from pathlib import Path

from sync_d1 import (
    STATE_VERSION,
    build_plan,
    default_state,
    read_models,
    render_sql,
    validate_removal_safety,
)


ROOT = Path(__file__).resolve().parents[1]
MIGRATIONS = ROOT / "migrations"


class CatalogD1SyncTests(unittest.TestCase):
    def setUp(self) -> None:
        self.db = sqlite3.connect(":memory:")
        self.db.row_factory = sqlite3.Row
        for name in (
            "0001_catalog.sql",
            "0002_keyset_pagination.sql",
            "0003_catalog_counts.sql",
            "0004_search_fts.sql",
            "0005_catalog_source_sync.sql",
        ):
            self.db.executescript((MIGRATIONS / name).read_text(encoding="utf-8"))

    def tearDown(self) -> None:
        self.db.close()

    @staticmethod
    def model(
        model_id: str,
        slug: str,
        code: str,
        name: str,
        *,
        category: str = "Games",
        category_slug: str = "games",
        franchise: str = "Saga",
        franchise_slug: str = "saga",
        gallery_version: int = 100,
        image_count: int = 3,
        collection: str = "",
        search_text: str | None = None,
    ) -> dict:
        return {
            "id": model_id,
            "slug": slug,
            "code": code,
            "sourceHierarchy": [category, franchise, name],
            "categoryName": category,
            "categorySlug": category_slug,
            "franchiseName": franchise,
            "franchiseSlug": franchise_slug,
            "displayName": name,
            "collection": collection,
            "searchText": search_text or f"{category} {franchise} {name} {code}".casefold(),
            "imageCount": image_count,
            "coverStorageKey": f"media/{model_id}/img_cover/card.webp",
            "galleryManifestKey": f"gallery/{model_id}/{gallery_version:024x}.json",
            "galleryVersion": gallery_version,
        }

    @staticmethod
    def source_hash(rows: list[dict]) -> str:
        import hashlib
        raw = "".join(json.dumps(row, ensure_ascii=False, sort_keys=True) + "\n" for row in rows).encode("utf-8")
        return hashlib.sha256(raw).hexdigest()

    def apply_plan(self, rows: list[dict], previous_state: dict):
        source_hash = self.source_hash(rows)
        plan = build_plan(rows, source_hash, previous_state)
        self.db.executescript(render_sql(plan))
        return plan

    def fts(self, phrase: str) -> list[str]:
        escaped = phrase.replace('"', '""')
        rows = self.db.execute(
            "SELECT model_id FROM models_fts WHERE models_fts MATCH ? ORDER BY model_id",
            (f'"{escaped}"',),
        ).fetchall()
        return [row[0] for row in rows]

    def test_first_sync_populates_catalog_counts_search_and_audit(self) -> None:
        rows = [
            self.model("mdl_alpha", "saga-alpha", "TS-ALPHA", "Alpha", search_text="games saga alpha heroico"),
            self.model("mdl_beta", "saga-beta", "TS-BETA", "Beta", search_text="games saga beta veloz"),
        ]
        plan = self.apply_plan(rows, default_state())

        self.assertEqual(plan.changed_count, 2)
        self.assertEqual(plan.removed_count, 0)
        self.assertEqual(self.db.execute("SELECT COUNT(*) FROM models WHERE published=1").fetchone()[0], 2)
        self.assertEqual(self.db.execute("SELECT model_count FROM categories WHERE slug='games'").fetchone()[0], 2)
        self.assertEqual(self.db.execute("SELECT model_count FROM franchises WHERE slug='saga'").fetchone()[0], 2)
        self.assertEqual(self.fts("alpha"), ["mdl_alpha"])
        self.assertEqual(self.fts("veloz"), ["mdl_beta"])

        audit = self.db.execute(
            "SELECT source_sha256,model_count,changed_count,removed_count FROM catalog_sync_runs WHERE id=?",
            (plan.sync_id,),
        ).fetchone()
        self.assertIsNotNone(audit)
        self.assertEqual(audit["source_sha256"], plan.source_sha256)
        self.assertEqual((audit["model_count"], audit["changed_count"], audit["removed_count"]), (2, 2, 0))

    def test_incremental_sync_preserves_curated_fields_and_tombstones_removed_model(self) -> None:
        first_rows = [
            self.model("mdl_alpha", "saga-alpha", "TS-ALPHA", "Alpha", search_text="games saga alpha antigo"),
            self.model("mdl_beta", "saga-beta", "TS-BETA", "Beta", search_text="games saga beta"),
        ]
        first = self.apply_plan(first_rows, default_state())
        self.db.execute(
            "UPDATE models SET material='Resina premium',height_cm=27.5,description='Texto curado manualmente' WHERE id='mdl_alpha'"
        )

        changed_alpha = self.model(
            "mdl_alpha",
            "saga-alpha",
            "TS-ALPHA",
            "Alpha",
            gallery_version=222,
            image_count=8,
            search_text="games saga alpha atualizado premium",
        )
        second = self.apply_plan([changed_alpha], first.next_state)

        self.assertEqual(second.changed_count, 1)
        self.assertEqual(second.removed_ids, ("mdl_beta",))
        alpha = self.db.execute(
            "SELECT published,image_count,gallery_version,material,height_cm,description,search_text FROM models WHERE id='mdl_alpha'"
        ).fetchone()
        self.assertEqual(alpha["published"], 1)
        self.assertEqual(alpha["image_count"], 8)
        self.assertEqual(alpha["gallery_version"], 222)
        self.assertEqual(alpha["material"], "Resina premium")
        self.assertEqual(alpha["height_cm"], 27.5)
        self.assertEqual(alpha["description"], "Texto curado manualmente")
        self.assertEqual(alpha["search_text"], "games saga alpha atualizado premium")

        beta = self.db.execute("SELECT published,slug,code FROM models WHERE id='mdl_beta'").fetchone()
        self.assertEqual(beta["published"], 0)
        self.assertEqual(beta["slug"], "__archived__-mdl_beta")
        self.assertEqual(beta["code"], "__ARCHIVED__-mdl_beta")
        self.assertEqual(self.db.execute("SELECT model_count FROM categories WHERE slug='games'").fetchone()[0], 1)
        self.assertEqual(self.db.execute("SELECT model_count FROM franchises WHERE slug='saga'").fetchone()[0], 1)
        self.assertEqual(self.fts("antigo"), [])
        self.assertEqual(self.fts("atualizado"), ["mdl_alpha"])

        audit = self.db.execute(
            "SELECT model_count,changed_count,removed_count FROM catalog_sync_runs WHERE id=?",
            (second.sync_id,),
        ).fetchone()
        self.assertEqual((audit["model_count"], audit["changed_count"], audit["removed_count"]), (1, 1, 1))

    def test_removed_model_can_return_with_original_public_slug_and_code(self) -> None:
        alpha = self.model("mdl_alpha", "saga-alpha", "TS-ALPHA", "Alpha")
        beta = self.model("mdl_beta", "saga-beta", "TS-BETA", "Beta")
        first = self.apply_plan([alpha, beta], default_state())
        second = self.apply_plan([alpha], first.next_state)
        third = self.apply_plan([alpha, beta], second.next_state)

        self.assertEqual(third.changed_count, 1)
        restored = self.db.execute("SELECT published,slug,code FROM models WHERE id='mdl_beta'").fetchone()
        self.assertEqual(restored["published"], 1)
        self.assertEqual(restored["slug"], "saga-beta")
        self.assertEqual(restored["code"], "TS-BETA")
        self.assertEqual(self.db.execute("SELECT model_count FROM categories WHERE slug='games'").fetchone()[0], 2)

    def test_slug_and_code_swap_is_safe_for_existing_models(self) -> None:
        alpha = self.model("mdl_alpha", "saga-alpha", "TS-ALPHA", "Alpha")
        beta = self.model("mdl_beta", "saga-beta", "TS-BETA", "Beta")
        first = self.apply_plan([alpha, beta], default_state())

        swapped_alpha = self.model("mdl_alpha", "saga-beta", "TS-BETA", "Alpha")
        swapped_beta = self.model("mdl_beta", "saga-alpha", "TS-ALPHA", "Beta")
        second = self.apply_plan([swapped_alpha, swapped_beta], first.next_state)

        self.assertEqual(second.moving_ids, ("mdl_alpha", "mdl_beta"))
        values = {
            row["id"]: (row["slug"], row["code"])
            for row in self.db.execute("SELECT id,slug,code FROM models WHERE published=1")
        }
        self.assertEqual(values["mdl_alpha"], ("saga-beta", "TS-BETA"))
        self.assertEqual(values["mdl_beta"], ("saga-alpha", "TS-ALPHA"))

    def test_same_state_produces_no_remote_changes(self) -> None:
        rows = [self.model("mdl_alpha", "saga-alpha", "TS-ALPHA", "Alpha")]
        first = build_plan(rows, self.source_hash(rows), default_state())
        second = build_plan(rows, self.source_hash(rows), first.next_state)
        self.assertEqual(second.changed_count, 0)
        self.assertEqual(second.removed_count, 0)
        self.assertFalse(second.has_remote_changes)

    def test_large_removal_is_blocked_unless_explicitly_allowed(self) -> None:
        previous = {
            "version": STATE_VERSION,
            "source_sha256": "old",
            "models": {
                f"mdl_{index:03d}": {"fingerprint": str(index), "slug": f"m-{index}", "code": f"TS-{index}"}
                for index in range(100)
            },
        }
        plan = build_plan([], "0" * 64, previous)
        with self.assertRaisesRegex(RuntimeError, "bloqueio de segurança"):
            validate_removal_safety(plan, previous, allow_large_removal=False)
        validate_removal_safety(plan, previous, allow_large_removal=True)

    def test_read_models_rejects_duplicate_slug_and_code(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "models.jsonl"
            first = self.model("mdl_alpha", "dup", "TS-DUP", "Alpha")
            second = self.model("mdl_beta", "dup", "TS-DUP", "Beta")
            path.write_text(json.dumps(first) + "\n" + json.dumps(second) + "\n", encoding="utf-8")
            with self.assertRaisesRegex(ValueError, "slug duplicado"):
                read_models(path)


if __name__ == "__main__":
    unittest.main()
