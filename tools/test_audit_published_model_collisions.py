import unittest
from audit_published_model_collisions import audit


class CollisionAuditTests(unittest.TestCase):
    def test_distinct_sculptures_same_name_require_review(self):
        rows = [
            {"id": "mdl_1", "name": "Gambit", "slug": "gambit-one", "franchise_id": "marvel"},
            {"id": "mdl_2", "name": " gambit ", "slug": "gambit-two", "franchise_id": "marvel"},
        ]
        output = audit(rows)
        self.assertEqual(output["totalRecords"], 2)
        self.assertEqual(len(output["sameFranchiseNormalizedNameCollisions"]), 1)
        self.assertFalse(output["sculptureUniquenessProven"])
        self.assertFalse(output["mutationAuthorized"])
        details = output["sameFranchiseNormalizedNameCollisions"][0]["modelMetadata"]
        self.assertEqual([d["modelId"] for d in details], ["mdl_1", "mdl_2"])
        self.assertEqual([d["slug"] for d in details], ["gambit-one", "gambit-two"])

    def test_same_name_different_franchises_not_merged(self):
        rows = [
            {"id": "mdl_1", "name": "Iron", "slug": "iron-marvel", "franchise_id": "marvel"},
            {"id": "mdl_2", "name": "Iron", "slug": "iron-solo", "franchise_id": "solo"},
        ]
        self.assertEqual(audit(rows)["sameFranchiseNormalizedNameCollisions"], [])

    def test_slug_collision_flagged(self):
        rows = [
            {"id": "mdl_1", "name": "First", "slug": "same", "franchise_id": 1},
            {"id": "mdl_2", "name": "Second", "slug": "same", "franchise_id": 2},
        ]
        self.assertEqual(len(audit(rows)["exactSlugCollisions"]), 1)

    def test_missing_slug_does_not_hide_same_name_collision(self):
        rows = [
            {"id": "mdl_a", "name": "Gambit", "slug": "", "franchise_id": 1},
            {"id": "mdl_b", "name": "gambit", "slug": "gambit-two", "franchise_id": 1},
        ]
        result = audit(rows)
        self.assertEqual(result["missingNameOrSlug"], ["mdl_a"])
        self.assertEqual(result["sameFranchiseNormalizedNameCollisions"][0]["modelIds"], ["mdl_a", "mdl_b"])
        self.assertEqual(result["exactSlugCollisions"], [])

    def test_missing_name_does_not_hide_duplicate_public_slug(self):
        rows = [
            {"id": "mdl_a", "name": "", "slug": "same-slug", "franchise_id": 1},
            {"id": "mdl_b", "name": "Other", "slug": "same-slug", "franchise_id": 2},
        ]
        result = audit(rows)
        self.assertEqual(result["missingNameOrSlug"], ["mdl_a"])
        self.assertEqual(result["exactSlugCollisions"][0]["modelIds"], ["mdl_a", "mdl_b"])
        self.assertEqual(result["sameFranchiseNormalizedNameCollisions"], [])

    def test_duplicate_record_id_fails_closed(self):
        rows = [{"id": "mdl_1", "name": "A", "slug": "a"},
                {"id": "mdl_1", "name": "B", "slug": "b"}]
        with self.assertRaises(ValueError):
            audit(rows)

    def test_invalid_or_empty_input_fails_closed(self):
        for rows in ([], [None], [{"name": "A", "slug": "a"}]):
            with self.subTest(rows=rows), self.assertRaises(ValueError):
                audit(rows)

    def test_missing_metadata_not_counted_as_unique(self):
        result = audit([{"id": "mdl_1", "name": "Test", "slug": ""}])
        self.assertEqual(result["missingNameOrSlug"], ["mdl_1"])
        self.assertIsNone(result["certifiedUniqueSculptures"])


if __name__ == "__main__":
    unittest.main()
