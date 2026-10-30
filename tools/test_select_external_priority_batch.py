import copy
import unittest

from plan_external_identity_triage import build_triage
from select_external_priority_batch import PriorityBatchError, choose_batch


def fixture():
    def source(pid, state, model_id, franchise="Anime"):
        row = {
            "sourceProductId": pid, "sourceName": str(pid), "sourceSlug": str(pid),
            "sourceCategories": [franchise], "state": state,
            "candidateMetadataSemantics": "review_only",
            "exactNameCandidates": [] if state == "unreviewed_no_exact_name_candidate" else [
                {"modelId": model_id, "franchiseName": franchise}],
            "reviewAliasCandidates": [{"modelId": model_id, "franchiseName": franchise}]
            if state == "unreviewed_no_exact_name_candidate" else [],
        }
        return row

    products = [
        source(10, "unreviewed_single_exact_name_candidate", "mdl_a"),
        source(11, "unreviewed_single_exact_name_candidate", "mdl_a"),
        source(12, "unreviewed_no_exact_name_candidate", "mdl_c"),
        source(13, "unreviewed_single_exact_name_candidate", "mdl_d", franchise="Comics"),
    ]
    coverage = {
        "sourceId": "external-source-001",
        "summary": {
            "sourceProducts": len(products), "publishedModels": 4,
            "confirmedPresent": 0, "coverage100Proven": False,
            "candidateMetadataSemantics": "review_only",
            "unreviewedAliasSuggestions": 1,
            "states": {
                "unreviewed_single_exact_name_candidate": 3,
                "unreviewed_no_exact_name_candidate": 1,
            },
            "productionWrites": 0, "stagingWrites": 0,
        },
        "products": products,
    }
    return coverage, build_triage(coverage)


class PriorityBatchTests(unittest.TestCase):
    def test_deduplicates_same_model_and_includes_alias_if_franchise_matches(self):
        coverage, triage = fixture()
        batch = choose_batch(coverage, triage, 3)
        self.assertEqual(batch["selectedProductIds"], [10, 13, 12])
        self.assertTrue(all(row["identityApproved"] is False for row in batch["selected"]))
        self.assertTrue(all(row["mediaPromotionAuthorized"] is False for row in batch["selected"]))
        self.assertEqual(batch["productionWrites"], 0)
        self.assertEqual(batch["stagingWrites"], 0)

    def test_franchise_mismatch_skipped_without_proving_absence(self):
        coverage, _ = fixture()
        coverage["products"][0]["sourceCategories"] = ["Comics"]
        batch = choose_batch(coverage, build_triage(coverage))
        self.assertEqual(batch["selectedProductIds"], [11, 13, 12])

    def test_unreviewed_alias_with_multiple_candidates_is_not_auto_selected(self):
        coverage, _ = fixture()
        coverage["products"][2]["reviewAliasCandidates"].append(
            {"modelId": "mdl_other", "franchiseName": "Anime"}
        )
        self.assertEqual(
            choose_batch(coverage, build_triage(coverage))["selectedProductIds"], [10, 13]
        )

    def test_duplicate_source_id_fails_closed(self):
        coverage, triage = fixture()
        coverage["products"][1]["sourceProductId"] = 10
        with self.assertRaisesRegex(PriorityBatchError, "invalid canonical coverage"):
            choose_batch(coverage, triage)

    def test_corrupted_coverage_fails_closed(self):
        coverage, triage = fixture()
        coverage["summary"]["sourceProducts"] = 99
        with self.assertRaisesRegex(PriorityBatchError, "invalid canonical coverage"):
            choose_batch(coverage, triage)

    def test_review_approval_field_fails_closed(self):
        coverage, triage = fixture()
        triage["workItems"][0]["identityApproved"] = True
        with self.assertRaisesRegex(PriorityBatchError, "triage differs"):
            choose_batch(coverage, triage)

    def test_drifted_candidate_metadata_cannot_use_stale_triage(self):
        coverage, triage = fixture()
        coverage["products"][0]["exactNameCandidates"][0]["modelId"] = "mdl_replaced"
        with self.assertRaisesRegex(PriorityBatchError, "triage differs"):
            choose_batch(coverage, triage)

    def test_drifted_source_title_cannot_use_stale_triage(self):
        coverage, triage = fixture()
        coverage["products"][0]["sourceName"] = "another sculpture"
        with self.assertRaisesRegex(PriorityBatchError, "triage differs"):
            choose_batch(coverage, triage)

    def test_forged_phase_and_candidate_id_cannot_override_canonical_planner(self):
        coverage, triage = fixture()
        triage["workItems"][0]["phase"] = "alias_review"
        with self.assertRaisesRegex(PriorityBatchError, "triage differs"):
            choose_batch(coverage, triage)
        coverage, triage = fixture()
        triage["workItems"][0]["candidateModelIds"] = ["mdl_fake"]
        with self.assertRaisesRegex(PriorityBatchError, "triage differs"):
            choose_batch(coverage, triage)

    def test_reordered_or_replaced_rows_are_not_accepted_as_same_snapshot(self):
        coverage, triage = fixture()
        reversed_rows = copy.deepcopy(triage)
        reversed_rows["workItems"].reverse()
        with self.assertRaisesRegex(PriorityBatchError, "triage differs"):
            choose_batch(coverage, reversed_rows)
        missing_row = copy.deepcopy(triage)
        missing_row["workItems"][-1]["sourceProductId"] = 999
        with self.assertRaisesRegex(PriorityBatchError, "triage differs"):
            choose_batch(coverage, missing_row)

    def test_source_snapshot_metadata_must_match(self):
        coverage, triage = fixture()
        triage["sourceId"] = "another-source"
        with self.assertRaisesRegex(PriorityBatchError, "triage differs"):
            choose_batch(coverage, triage)
        coverage, triage = fixture()
        triage["summary"]["phaseCounts"]["alias_review"] = 0
        with self.assertRaisesRegex(PriorityBatchError, "triage differs"):
            choose_batch(coverage, triage)

    def test_cannot_increase_source_download_limit(self):
        coverage, triage = fixture()
        with self.assertRaises(ValueError):
            choose_batch(coverage, triage, 10)

    def test_empty_when_all_candidates_cross_franchise(self):
        coverage, _ = fixture()
        for product in coverage["products"]:
            product["sourceCategories"] = ["Different"]
        self.assertEqual(
            choose_batch(coverage, build_triage(coverage))["selectedProductIds"], []
        )


if __name__ == "__main__":
    unittest.main()
