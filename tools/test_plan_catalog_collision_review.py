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

    def test_preserves_model_metadata_for_review(self):
        d = sample()
        d["sameFranchiseNormalizedNameCollisions"][0]["modelMetadata"] = [
            {"modelId": "mdl_a", "slug": "iron-one", "imageCount": 2},
            {"modelId": "mdl_b", "slug": "iron-two", "imageCount": 3}]
        out = plan(d)
        group = next(g for g in out["groups"] if g["normalizedName"] == "iron")
        self.assertEqual(len(group["modelMetadata"]), 2)
        self.assertFalse(group["mergeAuthorized"])

    def test_rejects_incomplete_model_metadata(self):
        d = sample()
        d["sameFranchiseNormalizedNameCollisions"][0]["modelMetadata"] = [{"modelId": "mdl_a"}]
        with self.assertRaises(ValueError):
            plan(d)

    def test_missing_images_block_visual_review_without_merge(self):
        d = sample()
        d["sameFranchiseNormalizedNameCollisions"][0]["modelMetadata"] = [
            {"modelId": "mdl_a", "imageCount": 0},
            {"modelId": "mdl_b", "imageCount": 2}]
        r = plan(d)
        group = next(g for g in r["groups"] if g["normalizedName"] == "iron")
        self.assertEqual(group["modelsWithoutImages"], ["mdl_a"])
        self.assertFalse(group["imageReviewReady"])
        self.assertFalse(group["visualEvidenceVerified"])
        self.assertEqual(r["summary"]["groupsBlockedByMissingImages"], 1)
        self.assertFalse(group["mergeAuthorized"])

    def test_declared_images_do_not_mean_visual_evidence_verified(self):
        d = sample()
        d["sameFranchiseNormalizedNameCollisions"][0]["modelMetadata"] = [
            {"modelId": "mdl_a", "imageCount": 1},
            {"modelId": "mdl_b", "imageCount": 4}]
        result = plan(d)
        group = next(g for g in result["groups"] if g["normalizedName"] == "iron")
        self.assertTrue(group["declaredImagesPresent"])
        self.assertFalse(group["imageReviewReady"])
        self.assertFalse(group["visualEvidenceVerified"])
        self.assertEqual(result["summary"]["groupsWithVerifiedVisualEvidence"], 0)

    def test_invalid_image_metadata_fails_closed(self):
        for count in (-1, None, True, "2"):
            d = sample()
            d["sameFranchiseNormalizedNameCollisions"][0]["modelMetadata"] = [
                {"modelId": "mdl_a", "imageCount": count},
                {"modelId": "mdl_b", "imageCount": 2}]
            with self.subTest(count=count), self.assertRaises(ValueError):
                plan(d)

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
