import unittest
from plan_catalog_collision_review import plan

def sample():
    return {"schemaVersion": 1, "classification": "review_only", "mutationAuthorized": False,
            "sculptureUniquenessProven": False, "totalRecords": 5, "uniqueRecordIds": 5,
            "exactSlugCollisions": [],
            "sameFranchiseNormalizedNameCollisions": [
                {"key": ["marvel", "iron"], "modelIds": ["mdl_b", "mdl_a"]},
                {"key": ["dc", "flash"], "modelIds": ["mdl_d", "mdl_c", "mdl_e"]}]}

class CollisionReviewTests(unittest.TestCase):
    def test_slug_conflicts_are_reviewed_without_assuming_same_sculpture(self):
        d = sample()
        d["exactSlugCollisions"] = [
            {"key": "same-slug", "modelIds": ["mdl_a", "mdl_c"],
             "modelMetadata": [{"modelId": "mdl_a", "imageCount": 2},
                               {"modelId": "mdl_c", "imageCount": 2}]}
        ]
        out = plan(d)
        self.assertEqual(out["summary"]["collisionGroups"], 2)
        self.assertEqual(out["summary"]["slugConflictGroups"], 1)
        self.assertEqual(out["summary"]["slugConflictRecords"], 2)
        self.assertEqual(out["summary"]["slugPotentialPairwiseComparisons"], 1)
        self.assertEqual(out["slugConflictGroups"][0]["normalizedSlug"], "same-slug")
        self.assertFalse(out["slugConflictGroups"][0]["mergeAuthorized"])
        self.assertFalse(out["slugConflictGroups"][0]["visualEvidenceVerified"])

    def test_invalid_slug_collision_group_fails_closed(self):
        for key in ("", 3, ["unexpected"], None):
            d = sample()
            d["exactSlugCollisions"] = [{"key": key, "modelIds": ["mdl_a", "mdl_c"]}]
            with self.subTest(key=key), self.assertRaises(ValueError):
                plan(d)

    def test_overlapping_slug_groups_fail_closed(self):
        d = sample()
        d["exactSlugCollisions"] = [
            {"key": "first", "modelIds": ["mdl_a", "mdl_c"]},
            {"key": "second", "modelIds": ["mdl_c", "mdl_d"]},
        ]
        with self.assertRaisesRegex(ValueError, "overlapping"):
            plan(d)

    def test_missing_slug_collisions_field_fails_closed(self):
        d = sample()
        del d["exactSlugCollisions"]
        with self.assertRaisesRegex(ValueError, "missing slug"):
            plan(d)

    def test_shared_sha_prioritizes_without_automatic_merges(self):
        sha_index = {
            "version": 1, "scope": "active_published_gallery_shared_sha_positive_evidence_only",
            "groups": [{"sourceSha256": "a" * 64, "modelIds": ["mdl_a", "mdl_b"]}],
            "imageIndexCompletenessProven": False, "identityApproved": False,
            "mergeAuthorized": False, "productionWrites": 0, "stagingWrites": 0,
            "imageBinariesDownloaded": 0,
        }
        out = plan(sample(), sha_index)
        self.assertEqual(out["groups"][0]["normalizedName"], "iron")
        self.assertEqual(out["summary"]["nameGroupsWithSharedImageSha"], 1)
        self.assertEqual(out["summary"]["namePairsWithSharedImageSha"], 1)
        self.assertFalse(out["summary"]["imageShaProvesSculptureIdentity"])
        pair = out["groups"][0]["sharedImageShaReviewPairs"][0]
        self.assertEqual(pair["modelIds"], ["mdl_a", "mdl_b"])
        self.assertFalse(pair["identityApproved"])
        self.assertFalse(out["groups"][0]["mergeAuthorized"])
        self.assertEqual(out["groups"][1]["shaReviewSignal"],
                         "no_positive_sha_signal_index_completeness_unknown")

    def test_sha_index_conflicting_or_unsafe_data_fails_closed(self):
        for changed in [
            {"imageIndexCompletenessProven": True},
            {"mergeAuthorized": True},
            {"productionWrites": 1},
            {"groups": [{"sourceSha256": "bad", "modelIds": ["mdl_a", "mdl_b"]}]},
            {"groups": [{"sourceSha256": "a" * 64, "modelIds": ["mdl_a", "mdl_a"]}]},
        ]:
            with self.subTest(changed=changed):
                index = {
                    "version": 1,
                    "scope": "active_published_gallery_shared_sha_positive_evidence_only",
                    "groups": [], "imageIndexCompletenessProven": False,
                    "identityApproved": False, "mergeAuthorized": False,
                    "productionWrites": 0, "stagingWrites": 0,
                    "imageBinariesDownloaded": 0,
                }
                index.update(changed)
                with self.assertRaises(ValueError):
                    plan(sample(), index)

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
