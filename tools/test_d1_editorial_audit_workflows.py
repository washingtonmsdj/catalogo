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

    def test_maintenance_requires_budget_before_expensive_database_operations(self):
        workflow = (WORKFLOWS / "catalog-maintenance.yml").read_text(encoding="utf-8")
        self.assertIn("group: cloudflare-api", workflow)
        self.assertIn("cancel-in-progress: false", workflow)
        budget = workflow.index("run: python tools/check_d1_editorial_audit_budget.py")
        health = workflow.index("run: node tools/check_worker_health.mjs")
        expensive = [
            "run: python tools/audit_d1_integrity.py",
            "run: python tools/apply_legacy_gallery_repairs.py",
            "run: python tools/backfill_image_source_index.py",
        ]
        self.assertLess(health, budget)
        for step in expensive:
            with self.subTest(step=step):
                self.assertLess(budget, workflow.index(step))
        self.assertIn("inputs.operation != 'verify-public-hierarchy'", workflow)

    def test_deploy_uses_same_concurrency_group(self):
        workflow = (WORKFLOWS / "cloudflare.yml").read_text(encoding="utf-8")
        self.assertIn("group: cloudflare-api", workflow)
        self.assertIn("cancel-in-progress: false", workflow)


if __name__ == "__main__":
    unittest.main()
