import unittest
from unittest.mock import patch

from enrich_external_candidate_identity import alias_hints, find_candidates, sql_like_literal, subject_hint


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
        self.assertNotIn("%", sql_like_literal("Kai%Sa").replace("\\%", ""))

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

    def test_subject_hint_decodes_entities(self):
        self.assertEqual(subject_hint("Tom &amp; Jerry"), "Tom & Jerry")


if __name__ == "__main__":
    unittest.main()
