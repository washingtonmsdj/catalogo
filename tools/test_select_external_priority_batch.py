import unittest

from select_external_priority_batch import PriorityBatchError, choose_batch


def fixture():
    def source(pid, phase, model_id, franchise="Anime"):
        return {
            "sourceProductId": pid, "sourceName": str(pid),
            "sourceCategories": [franchise], "state": phase,
            "exactNameCandidates": [] if phase == "unreviewed_no_exact_name_candidate" else [
                {"modelId": model_id, "franchiseName": franchise}],
            "reviewAliasCandidates": [{"modelId": model_id, "franchiseName": franchise}]
            if phase == "unreviewed_no_exact_name_candidate" else [],
        }
    products = [
        source(10, "unreviewed_single_exact_name_candidate", "mdl_a"),
        source(11, "unreviewed_single_exact_name_candidate", "mdl_a"),
        source(12, "unreviewed_no_exact_name_candidate", "mdl_c"),
        source(13, "unreviewed_single_exact_name_candidate", "mdl_d", franchise="Comics"),
    ]
    items = [
        {"sourceProductId": 10, "state": products[0]["state"], "phase": "visual_review",
         "identityApproved": False, "mediaPromotionAuthorized": False},
        {"sourceProductId": 11, "state": products[1]["state"], "phase": "visual_review",
         "identityApproved": False, "mediaPromotionAuthorized": False},
        {"sourceProductId": 12, "state": products[2]["state"], "phase": "alias_review",
         "identityApproved": False, "mediaPromotionAuthorized": False},
        {"sourceProductId": 13, "state": products[3]["state"], "phase": "visual_review",
         "identityApproved": False, "mediaPromotionAuthorized": False},
    ]
    return {
        "summary": {"sourceProducts": 4, "confirmedPresent": 0, "coverage100Proven": False,
                    "candidateMetadataSemantics": "review_only",
                    "productionWrites": 0, "stagingWrites": 0},
        "products": products, "sourceId": "external-source-001",
    }, {"summary": {"sourceProducts": 4, "confirmedPublishedIdentities": 0,
                   "workItems": 4, "productionWrites": 0, "stagingWrites": 0}, "workItems": items}


class PriorityBatchTests(unittest.TestCase):
    def test_deduplicates_same_model_and_includes_alias_if_franchise_matches(self):
        coverage, triage = fixture()
        batch = choose_batch(coverage, triage, 3)
        self.assertEqual(batch["selectedProductIds"], [10, 12, 13])
        self.assertTrue(all(row["identityApproved"] is False for row in batch["selected"]))
        self.assertTrue(all(row["mediaPromotionAuthorized"] is False for row in batch["selected"]))

    def test_franchise_mismatch_skipped_without_proving_absence(self):
        coverage, triage = fixture()
        coverage["products"][0]["sourceCategories"] = ["Comics"]
        batch = choose_batch(coverage, triage)
        self.assertEqual(batch["selectedProductIds"], [11, 12, 13])

    def test_unreviewed_alias_with_multiple_candidates_is_not_auto_selected(self):
        coverage, triage = fixture()
        coverage["products"][2]["reviewAliasCandidates"].append(
            {"modelId": "mdl_other", "franchiseName": "Anime"}
        )
        self.assertEqual(choose_batch(coverage, triage)["selectedProductIds"], [10, 13])

    def test_duplicate_source_id_fails_closed(self):
        coverage, triage = fixture()
        coverage["products"][1]["sourceProductId"] = 10
        with self.assertRaisesRegex(PriorityBatchError, "duplicate"):
            choose_batch(coverage, triage)

    def test_corrupted_coverage_fails_closed(self):
        coverage, triage = fixture()
        coverage["summary"]["sourceProducts"] = 99
        with self.assertRaisesRegex(PriorityBatchError, "inconsistent"):
            choose_batch(coverage, triage)

    def test_review_approval_field_fails_closed(self):
        coverage, triage = fixture()
        triage["workItems"][0]["identityApproved"] = True
        with self.assertRaisesRegex(PriorityBatchError, "review-only"):
            choose_batch(coverage, triage)

    def test_cannot_increase_source_download_limit(self):
        coverage, triage = fixture()
        with self.assertRaises(ValueError):
            choose_batch(coverage, triage, 10)

    def test_empty_when_all_candidates_cross_franchise(self):
        coverage, triage = fixture()
        for product in coverage["products"]:
            product["sourceCategories"] = ["Different"]
        self.assertEqual(choose_batch(coverage, triage)["selectedProductIds"], [])


if __name__ == "__main__":
    unittest.main()
