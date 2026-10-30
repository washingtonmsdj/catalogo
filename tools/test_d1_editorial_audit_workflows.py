import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
WORKFLOWS = ROOT / ".github" / "workflows"


class AuditWorkflowBudgetTests(unittest.TestCase):
    def test_editorial_d1_queries_have_preflight_and_no_parallel_cancellations(self):
        for name, first_d1_step in (
            ("external-source-coverage.yml", "Audit source coverage without media downloads or writes"),
            ("external-candidate-discovery.yml", "Discover candidates without writes"),
        ):
            with self.subTest(workflow=name):
                workflow = (WORKFLOWS / name).read_text(encoding="utf-8")
                self.assertIn("  workflow_dispatch:", workflow)
                self.assertNotIn("  pull_request:", workflow)
                self.assertIn("group: cloudflare-api", workflow)
                self.assertIn("cancel-in-progress: false", workflow)
                budget = workflow.index("python tools/check_d1_editorial_audit_budget.py")
                verify = workflow.index("Verify read-only")
                d1_read = workflow.index(first_d1_step)
                self.assertLess(verify, budget)
                self.assertLess(budget, d1_read)

    def test_database_maintenance_reserves_quota_before_its_first_read(self):
        workflow = (WORKFLOWS / "catalog-maintenance.yml").read_text(encoding="utf-8")
        self.assertIn("default: audit", workflow)
        self.assertIn("group: cloudflare-api", workflow)
        self.assertIn("cancel-in-progress: false", workflow)
        budget = workflow.index("- name: Reserve public D1 quota before database maintenance")
        next_step = workflow.index("- name: Validate active Worker health and schema")
        budget_block = workflow[budget:next_step]
        self.assertIn("inputs.operation != 'verify-public-hierarchy'", budget_block)
        self.assertIn("run: python tools/check_d1_editorial_audit_budget.py", budget_block)
        self.assertLess(budget, next_step)
        for step in (
            "- name: Audit D1 structural integrity",
            "- name: Plan reviewed legacy gallery repairs",
            "- name: Measure image SHA index coverage",
            "- name: Backfill image SHA index",
            "- name: Apply reviewed legacy gallery repairs",
        ):
            with self.subTest(step=step):
                self.assertLess(budget, workflow.index(step))

    def test_deploy_uses_same_concurrency_group(self):
        workflow = (WORKFLOWS / "cloudflare.yml").read_text(encoding="utf-8")
        self.assertIn("group: cloudflare-api", workflow)
        self.assertIn("cancel-in-progress: false", workflow)


if __name__ == "__main__":
    unittest.main()
