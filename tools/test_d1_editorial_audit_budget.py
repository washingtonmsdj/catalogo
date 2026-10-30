import unittest
from unittest.mock import patch

from audit_external_source_coverage import CoverageError
from check_d1_editorial_audit_budget import (
    ANALYTICS_API, MAX_EXISTING_READS_BEFORE_EDITORIAL_AUDIT,
    analytics_query, require_audit_budget, rows_read_for_account,
)

ACCOUNT = "8827c547d6def5ee5b9ca550fdd5680a"
DAY = "2026-10-30"


def payload(*counts):
    return {"data": {"viewer": {"accounts": [{
        "d1AnalyticsAdaptiveGroups": [{
            "dimensions": {"date": DAY, "databaseId": f"database-{i}"},
            "sum": {"rowsRead": count},
        } for i, count in enumerate(counts)],
    }]}}}


class BudgetTests(unittest.TestCase):
    def test_account_scope_and_utc_day_are_explicit(self):
        query = analytics_query(ACCOUNT, DAY)
        self.assertIn(ACCOUNT, query)
        self.assertIn(f'date_geq:"{DAY}"', query)
        self.assertIn(f'date_leq:"{DAY}"', query)
        self.assertNotIn("d1/database/", ANALYTICS_API)
        with self.assertRaises(CoverageError):
            analytics_query("bad-id", DAY)

    def test_sum_covers_all_databases_in_account(self):
        self.assertEqual(rows_read_for_account(payload(100_000, 50_000), DAY), 150_000)
        self.assertEqual(rows_read_for_account(payload(), DAY), 0)

    def test_allow_only_below_read_budget(self):
        with patch("check_d1_editorial_audit_budget.fetch_json", return_value=(payload(220_000, 30_000), {})) as fetch:
            self.assertEqual(require_audit_budget(ACCOUNT, "token", DAY), MAX_EXISTING_READS_BEFORE_EDITORIAL_AUDIT)
        self.assertEqual(fetch.call_args.args[0], ANALYTICS_API)
        self.assertIn("query", fetch.call_args.kwargs["body"])
        with patch("check_d1_editorial_audit_budget.fetch_json", return_value=(payload(250_001), {})):
            with self.assertRaisesRegex(CoverageError, "Do not retry"):
                require_audit_budget(ACCOUNT, "token", DAY)

    def test_fail_closed_on_missing_or_malformed_analytics(self):
        invalid = [
            {}, {"errors": [{"message": "no access"}]}, {"data": {}},
            {"data": {"viewer": {"accounts": []}}},
            {"data": {"viewer": {"accounts": [{}, {}]}}},
            {"data": {"viewer": {"accounts": [{}]}}},
            payload(-1), payload(True), payload("500"),
        ]
        wrong = payload(1)
        wrong["data"]["viewer"]["accounts"][0]["d1AnalyticsAdaptiveGroups"][0]["dimensions"]["date"] = "2026-10-29"
        invalid.append(wrong)
        for response in invalid:
            with self.subTest(response=response):
                with self.assertRaises(CoverageError):
                    rows_read_for_account(response, DAY)

    def test_truncated_analytics_cannot_approve_audit(self):
        with self.assertRaisesRegex(CoverageError, "truncated"):
            rows_read_for_account(payload(*range(100)), DAY)

    def test_graphql_failure_does_not_query_d1_or_retry(self):
        with patch("check_d1_editorial_audit_budget.fetch_json", side_effect=TimeoutError):
            with self.assertRaises(TimeoutError):
                require_audit_budget(ACCOUNT, "token", DAY)


if __name__ == "__main__":
    unittest.main()
