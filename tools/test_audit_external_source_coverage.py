import json
import tempfile
import urllib.error
import urllib.parse
import unittest
from pathlib import Path
from unittest.mock import patch

from audit_external_source_coverage import CoverageError, batch_model_ids, classify, fetch_json, fetch_source_products, review_alias_hints, review_evidence, subject_hint


class ExternalSourceCoverageTests(unittest.TestCase):
    def setUp(self):
        self.models = [
            {
                "id": "mdl_a", "name": "Azula", "slug": "avatar-azula", "code": "TS-A",
                "image_count": 1, "franchise_id": 10, "franchise_name": "Avatar",
                "franchise_slug": "avatar",
            },
            {
                "id": "mdl_r1", "name": "Ryu", "slug": "street-fighter-ryu-02", "code": "TS-R1",
                "image_count": 1, "franchise_id": 20, "franchise_name": "Street Fighter",
                "franchise_slug": "street-fighter",
            },
            {
                "id": "mdl_r2", "name": "Ryu", "slug": "street-fighter-ryu-03", "code": "TS-R2",
                "image_count": 2, "franchise_id": 20, "franchise_name": "Street Fighter",
                "franchise_slug": "street-fighter",
            },
            {
                "id": "mdl_new", "name": "Zoro 3 Diorama", "slug": "one-piece-zoro-3", "code": "TS-Z3",
                "image_count": 7, "franchise_id": 30, "franchise_name": "One Piece",
                "franchise_slug": "one-piece",
            },
        ]

    def test_subject_hint_is_review_only_character_hint(self):
        self.assertEqual(subject_hint("Ryu STL 3 – Street Fighter"), "Ryu")

    def test_title_franchise_suffix_creates_review_only_alias(self):
        product = [{
            "id": 253, "name": "Superman – DC", "slug": "superman",
            "categories": [{"name": "DC"}, {"name": "Comics"}],
        }]
        models = [{
            "id": "mdl_superman", "name": "Superman", "slug": "dc-superman",
            "franchise_name": "DC", "franchise_slug": "dc",
        }]
        result = classify(product, models, {}, {})
        row = result["products"][0]
        self.assertEqual(row["state"], "unreviewed_no_exact_name_candidate")
        self.assertEqual([x["modelId"] for x in row["reviewAliasCandidates"]], ["mdl_superman"])
        self.assertEqual(result["summary"]["unreviewedAliasSuggestions"], 1)
        self.assertEqual(result["summary"]["confirmedPresent"], 0)
        self.assertFalse(result["summary"]["coverage100Proven"])

    def test_category_and_decorations_are_suggestions_not_identity(self):
        hints = review_alias_hints(
            "Deadpool + Extras + Bust – Marvel – STL Files",
            ["Marvel", "Comics"],
        )
        self.assertIn("Deadpool", hints)
        self.assertNotIn("Marvel", hints)
        self.assertNotIn("STL Files", hints)
        self.assertEqual(review_alias_hints("Wonder Woman – Unrelated", ["DC"]), [])

    def test_alias_matches_capped_with_overflow_flag(self):
        products = [{"id": 101, "name": "Cammy White – Street Fighter",
                     "categories": [{"name": "Street Fighter"}]}]
        models = [{"id": f"mdl_{i}", "name": "Cammy White"} for i in range(30)]
        result = classify(products, models, {}, {})
        row = result["products"][0]
        self.assertEqual(len(row["reviewAliasCandidates"]), 24)
        self.assertTrue(row["reviewAliasCandidatesTruncated"])
        self.assertEqual(result["summary"]["confirmedPresent"], 0)

    def test_exact_candidate_still_stays_exact_without_automatic_approval(self):
        p = [{"id": 101, "name": "Ryu STL – Street Fighter",
              "categories": [{"name": "Street Fighter"}]}]
        result = classify(p, self.models, {}, {})
        self.assertEqual(result["products"][0]["state"], "unreviewed_multiple_exact_name_candidates")
        self.assertEqual(result["products"][0]["reviewAliasCandidates"], [])
        self.assertEqual(result["summary"]["confirmedPresent"], 0)

    def test_transient_anonymous_403_then_valid_page_is_retried_without_bypass(self):
        class Response:
            headers = {"X-WP-Total": "1", "X-WP-TotalPages": "1"}
            def __enter__(self):
                return self
            def __exit__(self, *args):
                return False
            def read(self):
                return b'[{"id": 1}]'
        err = urllib.error.HTTPError("https://source.test/api", 403, "Forbidden", {}, None)
        with patch("audit_external_source_coverage.urllib.request.urlopen", side_effect=[err, Response()]) as open_url, patch(
            "audit_external_source_coverage.time.sleep", return_value=None
        ) as sleep:
            payload, headers = fetch_json("https://source.test/api")
        self.assertEqual(payload, [{"id": 1}])
        self.assertEqual(headers["X-WP-Total"], "1")
        self.assertEqual(open_url.call_count, 2)
        sleep.assert_called_once_with(1)

    def test_persistent_public_403_is_a_hard_failure(self):
        err = urllib.error.HTTPError("https://source.test/api", 403, "Forbidden", {}, None)
        with patch("audit_external_source_coverage.urllib.request.urlopen", side_effect=err) as open_url, patch(
            "audit_external_source_coverage.time.sleep", return_value=None
        ) as sleep:
            with self.assertRaises(urllib.error.HTTPError):
                fetch_json("https://source.test/api")
        self.assertEqual(open_url.call_count, 4)
        self.assertEqual(sleep.call_count, 3)

    def test_authenticated_cloudflare_403_is_never_retried(self):
        err = urllib.error.HTTPError("https://api.cloudflare.com/client/v4/", 403, "Forbidden", {}, None)
        with patch("audit_external_source_coverage.urllib.request.urlopen", side_effect=err) as open_url, patch(
            "audit_external_source_coverage.time.sleep", return_value=None
        ) as sleep:
            with self.assertRaises(urllib.error.HTTPError):
                fetch_json("https://api.cloudflare.com/client/v4/", token="secret", body={"sql": "SELECT 1"})
        self.assertEqual(open_url.call_count, 1)
        sleep.assert_not_called()

    def test_anonymous_404_is_not_retried(self):
        err = urllib.error.HTTPError("https://source.test/missing", 404, "Not Found", {}, None)
        with patch("audit_external_source_coverage.urllib.request.urlopen", side_effect=err) as open_url, patch(
            "audit_external_source_coverage.time.sleep", return_value=None
        ) as sleep:
            with self.assertRaises(urllib.error.HTTPError):
                fetch_json("https://source.test/missing")
        self.assertEqual(open_url.call_count, 1)
        sleep.assert_not_called()

    def test_source_pagination_is_stable_and_requests_categories(self):
        requested: list[str] = []

        def fake_fetch(url, **_kwargs):
            requested.append(url)
            return ([{"id": 1, "name": "A", "slug": "a", "categories": []}], {"X-WP-Total": "1", "X-WP-TotalPages": "1"})

        with patch("audit_external_source_coverage.fetch_json", side_effect=fake_fetch):
            products, meta = fetch_source_products("https://example.com")

        self.assertEqual(len(products), 1)
        query = urllib.parse.parse_qs(urllib.parse.urlparse(requested[0]).query)
        self.assertEqual(query["orderby"], ["id"])
        self.assertEqual(query["order"], ["asc"])
        self.assertIn("categories", query["_fields"][0])
        self.assertEqual(meta["ordering"], "id_asc")

    def test_map_existing_is_confirmed_present(self):
        report = classify(
            [{"id": 10, "name": "Azula STL – Avatar", "slug": "azula", "categories": [{"name": "Avatar"}]}],
            self.models,
            {10: {"map_existing"}},
            {},
            {10: {"mdl_a"}},
        )
        self.assertEqual(report["summary"]["confirmedPresent"], 1)
        self.assertEqual(report["products"][0]["state"], "confirmed_present_map_existing")

    def test_map_existing_is_unresolved_when_target_not_published_or_not_proven(self):
        product = [{"id": 10, "name": "Azula STL – Avatar"}]
        for targets in ({}, {10: {"mdl_missing"}}, {10: {"mdl_a", "mdl_r1"}}):
            with self.subTest(targets=targets):
                report = classify(product, self.models, {10: {"map_existing"}}, {}, targets)
                self.assertEqual(report["summary"]["confirmedPresent"], 0)
                self.assertEqual(report["products"][0]["state"], "reviewed_unresolved")
                self.assertFalse(report["summary"]["coverage100Proven"])

    def test_only_approved_versioned_target_is_allowed_into_map_existing_proof(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "external-source-001-azula-gallery-review.json"
            evidence = {
                "sourceProductId": 10,
                "identityReview": {"decision": "map_existing", "targetModelId": "mdl_a"},
                "decision": {"mapExistingApproved": False},
            }
            path.write_text(json.dumps(evidence), encoding="utf-8")
            states, targets = review_evidence(Path(tmp))
            self.assertIn("map_existing", states[10])
            self.assertFalse(targets.get(10))
            evidence["decision"]["mapExistingApproved"] = True
            path.write_text(json.dumps(evidence), encoding="utf-8")
            states, targets = review_evidence(Path(tmp))
            self.assertEqual(targets[10], {"mdl_a"})
            report = classify([{"id": 10, "name": "Azula"}], self.models, states, {}, targets)
            self.assertEqual(report["summary"]["confirmedPresent"], 1)

    def test_unapproved_new_model_identity_cannot_prove_published_presence(self):
        with tempfile.TemporaryDirectory() as tmp:
            (Path(tmp) / "external-source-001-new-model.json").write_text(json.dumps({
                "sourceProductId": 12,
                "identityReview": {"decision": "new_model"},
                "decision": {"identityResolved": False, "newModelIdentityAuthorized": False},
            }), encoding="utf-8")
            states, targets = review_evidence(Path(tmp))
            report = classify(
                [{"id": 12, "name": "Zoro 3 Diorama"}],
                self.models, states, {12: "mdl_new"}, targets,
            )
            self.assertEqual(report["summary"]["confirmedPresent"], 0)
            self.assertEqual(report["products"][0]["state"], "reviewed_unresolved")

    def test_contradictory_identity_approvals_fail_closed(self):
        for identity, decision in (
            ({"decision": "new_model"}, {"identityResolved": False, "newModelIdentityAuthorized": True}),
            ({"decision": "map_existing", "targetModelId": "mdl_a", "mapExistingApproved": True},
             {"identityResolved": False}),
        ):
            with self.subTest(identity=identity), tempfile.TemporaryDirectory() as tmp:
                (Path(tmp) / "external-source-001-contradiction.json").write_text(json.dumps({
                    "sourceProductId": 10, "identityReview": identity, "decision": decision,
                }), encoding="utf-8")
                with self.assertRaisesRegex(CoverageError, "contradiz"):
                    review_evidence(Path(tmp))

    def test_conflicting_targets_across_evidence_files_fail_closed(self):
        with tempfile.TemporaryDirectory() as tmp:
            for suffix, target in (("a", "mdl_a"), ("b", "mdl_r1")):
                (Path(tmp) / f"external-source-001-{suffix}.json").write_text(json.dumps({
                    "sourceProductId": 10,
                    "identityReview": {"decision": "map_existing", "mapExistingApproved": True,
                                       "targetModelId": target},
                }), encoding="utf-8")
            with self.assertRaisesRegex(CoverageError, "entre evidências"):
                review_evidence(Path(tmp))

    def test_batch_model_targets_fail_closed_on_corruption_or_conflict(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            first = root / "external-source-001-batch-002.json"
            second = root / "external-source-001-batch-003.json"
            first.write_text(json.dumps({"products": [
                {"productId": 10, "expectedModelId": "mdl_a"},
            ]}), encoding="utf-8")
            second.write_text(json.dumps({"products": [
                {"productId": 10, "expectedModelId": "mdl_a"},
            ]}), encoding="utf-8")
            self.assertEqual(batch_model_ids(root), {10: "mdl_a"})
            second.write_text(json.dumps({"products": [
                {"productId": 10, "expectedModelId": "mdl_other"},
            ]}), encoding="utf-8")
            with self.assertRaisesRegex(CoverageError, "divergentes"):
                batch_model_ids(root)
            second.write_text("{invalid", encoding="utf-8")
            with self.assertRaisesRegex(CoverageError, "ilegível"):
                batch_model_ids(root)
            second.write_text(json.dumps({"products": [
                {"productId": True, "expectedModelId": "mdl_a"},
            ]}), encoding="utf-8")
            with self.assertRaisesRegex(CoverageError, "inválida"):
                batch_model_ids(root)

    def test_identity_proven_but_media_blocked_is_still_present(self):
        # A blocked gallery never grants media promotion, but does not erase
        # a reviewed identity that points to a currently published model.
        with tempfile.TemporaryDirectory() as tmp:
            evidence = {
                "sourceProductId": 14066,
                "identityReview": {
                    "decision": "map_existing",
                    "targetModelId": "mdl_a",
                },
                "decision": {
                    "identityResolved": True,
                    "galleryMediaReviewApproved": False,
                    "galleryPromotionApproved": False,
                },
            }
            (Path(tmp) / "external-source-001-okarun-review.json").write_text(
                json.dumps(evidence), encoding="utf-8"
            )
            states, targets = review_evidence(Path(tmp))
            self.assertIn("media_blocked_or_pending", states[14066])
            self.assertEqual(targets[14066], {"mdl_a"})
            report = classify(
                [{"id": 14066, "name": "Okarun STL 4"}],
                self.models, states, {}, targets,
            )
            self.assertEqual(report["products"][0]["state"], "confirmed_present_map_existing")
            self.assertEqual(report["summary"]["confirmedPresent"], 1)
            self.assertIn("media_blocked_or_pending", report["products"][0]["reviewStates"])

    def test_map_existing_conflicting_model_ids_fail_closed(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "external-source-001-conflict.json"
            path.write_text(json.dumps({
                "sourceProductId": 10,
                "identityReview": {
                    "decision": "map_existing",
                    "mapExistingApproved": True,
                    "targetModelId": "mdl_a",
                },
                "decision": {"canonicalModelId": "mdl_other"},
            }), encoding="utf-8")
            with self.assertRaises(CoverageError):
                review_evidence(Path(tmp))

    def test_source_pagination_fails_closed_when_total_or_order_drifts(self):
        def missing_product(_url, **_kwargs):
            return ([{"id": 1}], {"X-WP-Total": "2", "X-WP-TotalPages": "1"})
        with patch("audit_external_source_coverage.fetch_json", side_effect=missing_product):
            with self.assertRaisesRegex(CoverageError, "snapshot incompleto"):
                fetch_source_products("https://example.test")

        def reordered(_url, **_kwargs):
            return ([{"id": 2}, {"id": 1}], {"X-WP-Total": "2", "X-WP-TotalPages": "1"})
        with patch("audit_external_source_coverage.fetch_json", side_effect=reordered):
            with self.assertRaisesRegex(CoverageError, "fora de ordem"):
                fetch_source_products("https://example.test")

        def inconsistent_page_count(_url, **_kwargs):
            return ([{"id": 1}], {"X-WP-Total": "101", "X-WP-TotalPages": "1"})
        with patch("audit_external_source_coverage.fetch_json", side_effect=inconsistent_page_count):
            with self.assertRaisesRegex(CoverageError, "paginação de origem inconsistente"):
                fetch_source_products("https://example.test")

    def test_reviewed_new_model_is_not_present_until_deterministic_id_is_published(self):
        report = classify(
            [{"id": 11, "name": "Hisoka STL 2 – Hunter x Hunter", "slug": "hisoka"}],
            self.models,
            {11: {"new_model", "media_blocked_or_pending"}},
            {11: "mdl_missing"},
        )
        self.assertEqual(report["summary"]["confirmedPresent"], 0)
        self.assertEqual(report["summary"]["confirmedReviewedNewModelsNotPublished"], 1)
        self.assertFalse(report["summary"]["coverage100Proven"])

    def test_reviewed_identity_only_new_model_is_not_present_without_batch_id(self):
        report = classify(
            [{"id": 16, "name": "Morrigan STL – Dragon Age", "slug": "morrigan-dragon-age"}],
            self.models,
            {16: {"new_model"}},
            {},
        )
        self.assertEqual(report["summary"]["confirmedPresent"], 0)
        self.assertEqual(report["products"][0]["state"], "reviewed_new_model_not_published")
        self.assertIsNone(report["products"][0]["expectedModelId"])

    def test_reviewed_new_model_counts_present_only_when_expected_id_is_published(self):
        report = classify(
            [{"id": 12, "name": "Zoro STL 3 Diorama – One Piece", "slug": "zoro"}],
            self.models,
            {12: {"new_model"}},
            {12: "mdl_new"},
        )
        self.assertEqual(report["summary"]["confirmedPresent"], 1)
        self.assertEqual(report["products"][0]["state"], "confirmed_present_reviewed_new_model")

    def test_single_name_candidate_is_not_confirmed_and_exposes_review_metadata(self):
        report = classify(
            [{"id": 13, "name": "Azula STL – Avatar", "slug": "azula", "categories": [{"name": "Avatar"}]}],
            self.models,
            {},
            {},
        )
        row = report["products"][0]
        self.assertEqual(report["summary"]["confirmedPresent"], 0)
        self.assertEqual(row["state"], "unreviewed_single_exact_name_candidate")
        self.assertEqual(row["sourceCategories"], ["Avatar"])
        self.assertEqual(len(row["exactNameCandidates"]), 1)
        candidate = row["exactNameCandidates"][0]
        self.assertEqual(candidate["modelId"], "mdl_a")
        self.assertEqual(candidate["franchiseName"], "Avatar")
        self.assertEqual(candidate["franchiseSlug"], "avatar")
        self.assertEqual(row["candidateMetadataSemantics"], "review_only")

    def test_multiple_same_character_models_are_review_only_with_all_candidates(self):
        report = classify(
            [{"id": 14, "name": "Ryu STL 3 – Street Fighter", "slug": "ryu-3"}],
            self.models,
            {},
            {},
        )
        row = report["products"][0]
        self.assertEqual(report["summary"]["confirmedPresent"], 0)
        self.assertEqual(row["state"], "unreviewed_multiple_exact_name_candidates")
        self.assertEqual({c["modelId"] for c in row["exactNameCandidates"]}, {"mdl_r1", "mdl_r2"})
        self.assertEqual(report["summary"]["candidateMetadataSemantics"], "review_only")

    def test_missing_name_candidate_is_not_silently_declared_missing_or_present(self):
        report = classify(
            [{"id": 15, "name": "Completely New Character STL – Game", "slug": "new"}],
            self.models,
            {},
            {},
        )
        self.assertEqual(report["products"][0]["state"], "unreviewed_no_exact_name_candidate")
        self.assertEqual(report["products"][0]["exactNameCandidates"], [])
        self.assertFalse(report["summary"]["coverage100Proven"])


if __name__ == "__main__":
    unittest.main()
