from __future__ import annotations

import unittest
from unittest.mock import patch

from apply_legacy_gallery_repairs import (
    apply_statement_batches,
    count_integrity_statements,
    plan_repairs,
    published_model_count,
    verify_applied,
    verify_materialized_counts,
)


def group() -> dict:
    return {
        "categorySlug": "animes-desenhos",
        "franchiseSlug": "dragon-ball",
        "folderPathKey": "androides/androide-18",
        "family": "dragon-ball-androide-18-traje-casual",
        "canonicalSlug": "dragon-ball-androide-18-traje-casual-frente",
        "memberSlugs": [
            "dragon-ball-androide-18-traje-casual-frente",
            "dragon-ball-androide-18-traje-casual-lateral",
            "dragon-ball-androide-18-traje-casual-costas",
        ],
        "reason": "teste",
    }


def row(slug: str, *, published: int = 1) -> dict:
    return {
        "id": f"mdl-{slug}",
        "slug": slug,
        "code": f"TS-{slug}",
        "name": "Androide 18",
        "published": published,
        "image_count": 1,
        "gallery_version": 1,
        "gallery_manifest_key": f"gallery/mdl-{slug}/manifest.json",
        "cover_storage_key": f"media/mdl-{slug}/card.webp",
        "category_slug": "animes-desenhos",
        "franchise_slug": "dragon-ball",
        "folder_path": "androides/androide-18",
    }


class LegacyGalleryRepairTests(unittest.TestCase):
    def test_clean_state_plans_only_source_relations(self) -> None:
        config = [group()]
        rows = [row(slug) for slug in config[0]["memberSlugs"]]

        plan = plan_repairs(config, rows, [])

        self.assertTrue(plan["ready"])
        self.assertEqual(plan["groups"], 1)
        self.assertEqual(plan["memberCards"], 3)
        self.assertEqual(plan["expectedRelations"], 2)
        self.assertEqual(plan["pendingRelations"], 2)
        self.assertEqual(plan["sourcesToRetire"], 2)
        self.assertEqual(plan["destructiveDeletes"], 0)
        self.assertEqual(
            [statement["params"][0] for statement in plan["statements"]],
            [1, 2],
        )

    def test_partial_progress_is_idempotent_and_only_plans_missing_relation(self) -> None:
        config = [group()]
        canonical, side, back = config[0]["memberSlugs"]
        rows = [row(canonical), row(side, published=0), row(back)]
        relations = [{
            "canonical_slug": canonical,
            "source_slug": side,
            "position": 1,
        }]

        plan = plan_repairs(config, rows, relations)

        self.assertEqual(plan["existingRelations"], 1)
        self.assertEqual(plan["pendingRelations"], 1)
        self.assertEqual(plan["sourcesToRetire"], 1)
        self.assertEqual(plan["statements"][0]["params"], [2, back, canonical])

    def test_retired_source_without_relation_fails_closed(self) -> None:
        config = [group()]
        canonical, side, back = config[0]["memberSlugs"]
        rows = [row(canonical), row(side, published=0), row(back)]

        with self.assertRaisesRegex(RuntimeError, "não publicada sem relação"):
            plan_repairs(config, rows, [])

    def test_source_attached_to_wrong_canonical_fails_closed(self) -> None:
        config = [group()]
        canonical, side, back = config[0]["memberSlugs"]
        rows = [row(canonical), row(side, published=0), row(back)]
        relations = [{
            "canonical_slug": "outro-modelo",
            "source_slug": side,
            "position": 1,
        }]

        with self.assertRaisesRegex(RuntimeError, "outro canônico"):
            plan_repairs(config, rows, relations)

    def test_scope_mismatch_fails_closed(self) -> None:
        config = [group()]
        rows = [row(slug) for slug in config[0]["memberSlugs"]]
        rows[-1]["folder_path"] = "androides/outra-pasta"

        with self.assertRaisesRegex(RuntimeError, "divergem de escopo"):
            plan_repairs(config, rows, [])

    def test_apply_batches_are_bounded_and_retriable(self) -> None:
        statements = [{"sql": "SELECT 1", "params": []} for _ in range(205)]

        with patch("apply_legacy_gallery_repairs.d1_request") as request:
            batches = apply_statement_batches(statements, batch_size=100)

        self.assertEqual(batches, 3)
        self.assertEqual([len(call.args[0]) for call in request.call_args_list], [100, 100, 5])

        with self.assertRaises(ValueError):
            apply_statement_batches([], batch_size=251)

    def test_public_model_count_reads_only_published_cards(self) -> None:
        response = [{"success": True, "results": [{"total": 2567}]}]
        with patch("apply_legacy_gallery_repairs.d1_request", return_value=response) as request:
            total = published_model_count()

        self.assertEqual(total, 2567)
        sql = request.call_args.args[0][0]["sql"]
        self.assertIn("WHERE published=1", sql)

    def test_materialized_count_verification_covers_all_public_levels(self) -> None:
        specs = count_integrity_statements()

        self.assertEqual(
            [item["name"] for item in specs],
            ["categories", "franchises", "folders_direct", "folders_subtree"],
        )
        self.assertIn("direct_model_count", specs[2]["sql"])
        self.assertIn("subtree_model_count", specs[3]["sql"])
        self.assertIn("WITH RECURSIVE tree", specs[3]["sql"])

        zero = [
            {"success": True, "results": [{"mismatches": 0}]}
            for _ in specs
        ]
        with patch("apply_legacy_gallery_repairs.d1_request", return_value=zero):
            result = verify_materialized_counts()
        self.assertTrue(result["ready"])
        self.assertEqual(result["mismatches"]["categories"], 0)

        bad = list(zero)
        bad[1] = {"success": True, "results": [{"mismatches": 2}]}
        with patch("apply_legacy_gallery_repairs.d1_request", return_value=bad):
            with self.assertRaisesRegex(RuntimeError, "franchises=2"):
                verify_materialized_counts()

    def test_completed_state_verifies_with_zero_pending_relations(self) -> None:
        config = [group()]
        canonical, side, back = config[0]["memberSlugs"]
        rows = [row(canonical), row(side, published=0), row(back, published=0)]
        relations = [
            {"canonical_slug": canonical, "source_slug": side, "position": 1},
            {"canonical_slug": canonical, "source_slug": back, "position": 2},
        ]

        result = verify_applied(config, rows, relations)

        self.assertTrue(result["ready"])
        self.assertEqual(result["relations"], 2)
        self.assertEqual(result["publishedCanonicals"], 1)
        self.assertEqual(result["retiredSources"], 2)
        self.assertEqual(result["destructiveDeletes"], 0)


if __name__ == "__main__":
    unittest.main()
