import unittest
import json
import tempfile
from pathlib import Path
from unittest.mock import patch

from enrich_external_candidate_identity import (
    alias_hints, find_candidates, priority_scope, sql_like_literal, subject_hint,
)


class EnrichExternalCandidateIdentityTests(unittest.TestCase):
    def test_subject_hint_removes_stl_suffix_without_deciding_identity(self):
        self.assertEqual(subject_hint("Kaido STL 2 &#8211; One Piece"), "Kaido")
        self.assertEqual(subject_hint("Jiraiya STL &#8211; Naruto"), "Jiraiya")

    def test_subject_hint_preserves_plain_names(self):
        self.assertEqual(subject_hint("Groot and Rocket"), "Groot and Rocket")

    def test_aliases_handle_curly_apostrophes_and_combined_names(self):
        self.assertEqual(alias_hints("Kai’Sa"), ["KaiSa", "Kai Sa"])
        self.assertEqual(alias_hints("Groot and Rocket"), ["Groot", "Rocket"])
        self.assertEqual(alias_hints("Tom & Jerry"), ["Jerry"])  # Tom too short
        self.assertEqual(alias_hints("Bane"), [])
        self.assertEqual(sql_like_literal("Kai%Sa"), "%kai!%sa%")
        self.assertEqual(sql_like_literal("A_B"), "%a!_b%")
        self.assertEqual(sql_like_literal("A!_B%"), "%a!!!_b!%%")

    def test_fallback_is_bounded_parameterized_and_never_authorizes_identity(self):
        fallback_model = {"id": "mdl_a", "name": "Kaisa", "slug": "kaisa"}
        responses = [
            {"success": True, "result": [{"results": []}]},
            {"success": True, "result": [{"results": [fallback_model, fallback_model]}]},
        ]
        with patch("enrich_external_candidate_identity.post_json", side_effect=responses) as query:
            rows = find_candidates("account", "secret", "database", "Kai’Sa")
        self.assertEqual(len(rows), 1)
        self.assertEqual(rows[0]["_matchBasis"], "alias_fallback_review_only")
        self.assertEqual(query.call_count, 2)
        payload = query.call_args.args[1]
        self.assertEqual(payload["params"][-1], 12)
        self.assertIn("%kaisa%", payload["params"])
        self.assertIn("%kai sa%", payload["params"])
        self.assertNotIn("Kai’Sa", payload["sql"])
        self.assertIn("ESCAPE '!'", payload["sql"])

    def test_exact_match_skips_alias_fallback(self):
        rows = [{"id": "mdl_exact", "name": "Kai’Sa"}]
        with patch("enrich_external_candidate_identity.post_json", return_value={
            "success": True, "result": [{"results": rows}]
        }) as query:
            self.assertEqual(find_candidates("account", "token", "database", "Kai’Sa"), rows)
        query.assert_called_once()

    def test_unrecognized_fallback_sql_error_is_fail_closed(self):
        responses = [
            {"success": True, "result": [{"results": []}]},
            {"success": False, "errors": [{"message": "D1 unavailable"}]},
        ]
        with patch("enrich_external_candidate_identity.post_json", side_effect=responses):
            with self.assertRaisesRegex(RuntimeError, "consulta D1 alias"):
                find_candidates("account", "token", "database", "Groot and Rocket")

    def test_priority_candidate_queries_only_selected_canonical_id(self):
        result = {"success": True, "result": [{"results": [
            {"id": "mdl_matrix", "name": "Neo", "cover_storage_key": "media/cover.webp"}
        ]}]}
        with patch("enrich_external_candidate_identity.post_json", return_value=result) as call:
            rows = find_candidates("account", "token", "db", "Neo",
                                   selected_model_id="mdl_matrix")
        self.assertEqual([x["id"] for x in rows], ["mdl_matrix"])
        self.assertEqual(rows[0]["_matchBasis"], "priority_canonical_id_review_only")
        call.assert_called_once()
        sql = call.call_args.args[1]["sql"]
        self.assertIn("published=1 AND id=?", sql)
        self.assertNotIn("LIKE", sql)
        self.assertEqual(call.call_args.args[1]["params"], ["mdl_matrix"])

    def test_missing_priority_candidate_is_hard_failure_not_unbounded_fallback(self):
        response = {"success": True, "result": [{"results": []}]}
        with patch("enrich_external_candidate_identity.post_json", return_value=response) as call:
            with self.assertRaisesRegex(RuntimeError, "missing or ambiguous"):
                find_candidates("account", "token", "db", "Neo", selected_model_id="mdl_missing")
        call.assert_called_once()

    def test_priority_scope_requires_exact_downloaded_ids_and_unique_models(self):
        report = {"requestedProductIds": [1, 2]}
        batch = {"selectedProductIds": [1, 2], "selected": [
            {"sourceProductId": 1, "candidateModelId": "mdl_one", "identityApproved": False,
             "mediaPromotionAuthorized": False},
            {"sourceProductId": 2, "candidateModelId": "mdl_two", "identityApproved": False,
             "mediaPromotionAuthorized": False},
        ], "productionWrites": 0, "stagingWrites": 0}
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "batch.json"
            path.write_text(json.dumps(batch), encoding="utf-8")
            self.assertEqual(priority_scope(path, report), {1: "mdl_one", 2: "mdl_two"})
            with self.assertRaisesRegex(RuntimeError, "differs"):
                priority_scope(path, {"requestedProductIds": [2, 1]})
            batch["selected"][1]["candidateModelId"] = "mdl_one"
            path.write_text(json.dumps(batch), encoding="utf-8")
            with self.assertRaisesRegex(RuntimeError, "duplicate"):
                priority_scope(path, report)

    def test_subject_hint_decodes_entities(self):
        self.assertEqual(subject_hint("Tom &amp; Jerry"), "Tom & Jerry")


if __name__ == "__main__":
    unittest.main()
