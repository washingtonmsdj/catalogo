import unittest

from plan_external_identity_triage import TriageError, build_triage


def fixture():
    states = [
        (10, "confirmed_present_map_existing", 0),
        (11, "reviewed_new_model_not_published", 0),
        (12, "reviewed_unresolved", 0),
        (13, "unreviewed_single_exact_name_candidate", 1),
        (14, "unreviewed_multiple_exact_name_candidates", 2),
        (15, "unreviewed_no_exact_name_candidate", 0),
    ]
    products = [{
        "sourceProductId": pid, "sourceName": str(pid), "sourceSlug": str(pid),
        "state": state, "candidateMetadataSemantics": "review_only",
        "exactNameCandidates": [{"modelId": f"mdl_{i}"} for i in range(n)],
    } for pid, state, n in states]
    return {
        "sourceId": "external-source-001",
        "summary": {
            "sourceProducts": len(products), "publishedModels": 4, "confirmedPresent": 1,
            "candidateMetadataSemantics": "review_only", "coverage100Proven": False,
            "productionWrites": 0, "stagingWrites": 0,
            "states": {state: 1 for _, state, _ in states},
        }, "products": products,
    }


class IdentityTriageTests(unittest.TestCase):
    def test_triage_is_complete_bounded_and_never_approves_identity(self):
        result = build_triage(fixture())
        self.assertEqual(result["summary"]["workItems"], 5)
        self.assertEqual(result["summary"]["confirmedPublishedIdentities"], 1)
        self.assertEqual([x["sourceProductId"] for x in result["workItems"]], [13, 14, 12, 15, 11])
        self.assertTrue(all(not x["identityApproved"] and not x["mediaPromotionAuthorized"] for x in result["workItems"]))
        self.assertTrue(all(x["productionWrites"] == 0 for x in result["workItems"]))

    def test_unreviewed_alias_candidates_are_review_only_and_prioritized(self):
        data = fixture()
        row = data["products"][5]
        row["reviewAliasCandidates"] = [{"modelId": "mdl_review"}]
        row["reviewAliasCandidatesTruncated"] = False
        data["summary"]["unreviewedAliasSuggestions"] = 1
        result = build_triage(data)
        item = next(x for x in result["workItems"] if x["sourceProductId"] == 15)
        self.assertEqual(item["phase"], "alias_review")
        self.assertEqual(item["aliasCandidateModelIds"], ["mdl_review"])
        self.assertFalse(item["identityApproved"])
        self.assertEqual(result["summary"]["confirmedPublishedIdentities"], 1)

    def test_alias_overflow_remains_historical_search(self):
        data = fixture()
        data["products"][5]["reviewAliasCandidates"] = [{"modelId": "mdl_review"}]
        data["products"][5]["reviewAliasCandidatesTruncated"] = True
        out = build_triage(data)
        self.assertEqual(next(x for x in out["workItems"] if x["sourceProductId"] == 15)["phase"],
                         "alias_search")

    def test_alias_candidates_cannot_be_attached_to_confirmed_exact_states(self):
        data = fixture()
        data["products"][3]["reviewAliasCandidates"] = [{"modelId": "mdl_review"}]
        with self.assertRaisesRegex(TriageError, "cannot override"):
            build_triage(data)

    def test_duplicate_id_fails_closed(self):
        data = fixture()
        data["products"][1]["sourceProductId"] = 10
        with self.assertRaisesRegex(TriageError, "duplicate"):
            build_triage(data)

    def test_partial_source_snapshot_fails(self):
        data = fixture()
        data["summary"]["sourceProducts"] += 1
        with self.assertRaisesRegex(TriageError, "incomplete"):
            build_triage(data)

    def test_no_name_match_remains_alias_search_not_new_model(self):
        result = build_triage(fixture())
        row = next(x for x in result["workItems"] if x["sourceProductId"] == 15)
        self.assertEqual(row["phase"], "alias_search")
        self.assertFalse(row["identityApproved"])

    def test_unknown_state_fails_closed(self):
        data = fixture()
        data["products"][1]["state"] = "approved_by_name"
        with self.assertRaisesRegex(TriageError, "unknown source state"):
            build_triage(data)

    def test_report_counts_must_match(self):
        data = fixture()
        data["summary"]["confirmedPresent"] += 1
        with self.assertRaisesRegex(TriageError, "confirmed identity count"):
            build_triage(data)

    def test_candidate_count_must_match_state(self):
        data = fixture()
        data["products"][3]["exactNameCandidates"] = []
        with self.assertRaisesRegex(TriageError, "single-candidate state"):
            build_triage(data)

    def test_any_write_metadata_causes_failure(self):
        data = fixture()
        data["summary"]["stagingWrites"] = 1
        with self.assertRaisesRegex(TriageError, "unexpected production or staging writes"):
            build_triage(data)

    def test_coverage_boolean_cannot_falsely_be_true(self):
        data = fixture()
        data["summary"]["coverage100Proven"] = True
        with self.assertRaisesRegex(TriageError, "coverage100Proven"):
            build_triage(data)


if __name__ == "__main__":
    unittest.main()
