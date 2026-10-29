import unittest
from plan_catalog_collision_review import plan

def sample():
    return {"schemaVersion": 1, "classification": "review_only", "mutationAuthorized": False,
            "sculptureUniquenessProven": False, "totalRecords": 5, "uniqueRecordIds": 5,
            "sameFranchiseNormalizedNameCollisions": [
                {"key": ["marvel", "iron"], "modelIds": ["mdl_b", "mdl_a"]},
                {"key": ["dc", "flash"], "modelIds": ["mdl_d", "mdl_c", "mdl_e"]}]}

class CollisionReviewTests(unittest.TestCase):
    def test_priority_and_review_only(self):
        r = plan(sample())
        self.assertEqual(r["summary"]["potentialPairwiseComparisons"], 4)
        self.assertEqual(r["groups"][0]["normalizedName"], "flash")
        self.assertIsNone(r["summary"]["confirmedDuplicateSculptures"])
        self.assertFalse(r["groups"][0]["mergeAuthorized"])

    def test_unflagged_models(self):
        d = sample()
        d["totalRecords"] = d["uniqueRecordIds"] = 8
        self.assertEqual(plan(d)["summary"]["recordsOutsideNameCollisionGroups"], 3)

    def test_rejects_overlapping_membership(self):
        d = sample()
        d["sameFranchiseNormalizedNameCollisions"][1]["modelIds"][0] = "mdl_a"
        with self.assertRaises(ValueError):
            plan(d)

    def test_rejects_duplicate_member(self):
        d = sample()
        d["sameFranchiseNormalizedNameCollisions"][0]["modelIds"] = ["mdl_a", "mdl_a"]
        with self.assertRaises(ValueError):
            plan(d)

    def test_rejects_mutation(self):
        d = sample()
        d["mutationAuthorized"] = True
        with self.assertRaises(ValueError):
            plan(d)

    def test_rejects_empty_name(self):
        d = sample()
        d["sameFranchiseNormalizedNameCollisions"][0]["key"][1] = ""
        with self.assertRaises(ValueError):
            plan(d)

    def test_rejects_excess_membership(self):
        d = sample()
        d["totalRecords"] = d["uniqueRecordIds"] = 4
        with self.assertRaises(ValueError):
            plan(d)

if __name__ == "__main__":
    unittest.main()
