import unittest

from plan_gallery_merge import plan_gallery_merge


def row(
    path: str,
    sha: str,
    dhash: str,
    quality: float,
    *,
    model: str = "Games / Saga / Heroi / heroi-modelo-01",
    width: int = 800,
    height: int = 1200,
    size: int = 100_000,
):
    return {
        "path": path,
        "status": "OK",
        "canonical": True,
        "sha256": sha,
        "dhash": dhash,
        "quality_score": quality,
        "width": width,
        "height": height,
        "size": size,
        "model_key": "Games / Saga / Heroi",
        "public_model_key": model,
    }


class GalleryMergePlannerTests(unittest.TestCase):
    def test_exact_duplicate_is_skipped_without_mutation(self):
        existing = [row("catalogo/frente.jpg", "a" * 64, "0000000000000000", 70)]
        incoming = [row("stlforge/frente.png", "a" * 64, "0000000000000000", 95, width=1800, height=2400)]

        plan = plan_gallery_merge(existing, incoming)

        self.assertEqual(plan["counts"], {"skip_exact": 1})
        self.assertEqual(plan["actions"][0]["action"], "skip_exact")
        self.assertEqual(plan["policy"]["destructiveDeletes"], 0)

    def test_distinct_front_back_views_are_both_kept(self):
        existing = [row("catalogo/frente.jpg", "a" * 64, "0000000000000000", 70)]
        incoming = [row("stlforge/costas.jpg", "b" * 64, "ffffffffffffffff", 85)]

        plan = plan_gallery_merge(existing, incoming)

        self.assertEqual(plan["counts"], {"add_view": 1})
        self.assertEqual(plan["actions"][0]["action"], "add_view")

    def test_near_visual_higher_quality_incoming_is_reviewed_and_preferred(self):
        existing = [row("catalogo/frente.jpg", "a" * 64, "0000000000000000", 55, width=600, height=900)]
        incoming = [row("stlforge/frente-hq.png", "b" * 64, "0000000000000001", 92, width=1800, height=2700)]

        plan = plan_gallery_merge(existing, incoming)

        self.assertEqual(plan["counts"]["review_visual_candidate"], 1)
        self.assertEqual(plan["counts"]["review_prefers_incoming"], 1)
        action = plan["actions"][0]
        self.assertEqual(action["action"], "review_visual_candidate")
        self.assertEqual(action["recommendedSource"], "incoming")
        self.assertEqual(action["matches"][0]["dhashDistance"], 1)

    def test_near_visual_lower_quality_incoming_does_not_replace_existing(self):
        existing = [row("catalogo/frente-hq.png", "a" * 64, "0000000000000000", 95, width=1800, height=2700)]
        incoming = [row("stlforge/frente-low.jpg", "b" * 64, "0000000000000003", 40, width=500, height=750)]

        plan = plan_gallery_merge(existing, incoming)

        self.assertEqual(plan["counts"]["review_prefers_existing"], 1)
        self.assertEqual(plan["actions"][0]["recommendedSource"], "existing_or_planned")

    def test_multiple_incoming_views_for_same_model_remain_one_model_plan(self):
        existing = []
        incoming = [
            row("stlforge/frente.jpg", "a" * 64, "0000000000000000", 80),
            row("stlforge/costas.jpg", "b" * 64, "ffffffffffffffff", 78),
            row("stlforge/lateral.jpg", "c" * 64, "aaaaaaaaaaaaaaaa", 76),
        ]

        plan = plan_gallery_merge(existing, incoming)

        self.assertEqual(plan["modelsTouched"], 1)
        self.assertEqual(plan["counts"], {"add_view": 3})

    def test_incoming_exact_duplicate_inside_batch_is_added_once(self):
        incoming = [
            row("stlforge/frente-a.jpg", "a" * 64, "0000000000000000", 80),
            row("stlforge/frente-b.jpg", "a" * 64, "0000000000000000", 80),
        ]

        plan = plan_gallery_merge([], incoming)

        self.assertEqual(plan["counts"], {"add_view": 1, "skip_exact": 1})


if __name__ == "__main__":
    unittest.main()
