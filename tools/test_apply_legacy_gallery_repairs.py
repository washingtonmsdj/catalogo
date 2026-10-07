from __future__ import annotations

import unittest

from apply_legacy_gallery_repairs import plan_repairs, verify_applied


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
