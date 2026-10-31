import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
WORKFLOWS = ROOT / ".github" / "workflows"


class AuditWorkflowBudgetTests(unittest.TestCase):
    def test_editorial_d1_queries_have_preflight_and_no_parallel_cancellations(self):
        for name, first_d1_step in (
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

    def test_full_snapshot_coverage_is_disabled_until_read_cost_is_bounded(self):
        self.assertFalse((WORKFLOWS / "external-source-coverage.yml").exists())
        self.assertTrue((ROOT / "tools/audit_external_source_coverage.py").is_file())
        self.assertTrue((ROOT / "tools/audit_published_sha_inventory.py").is_file())

    def test_manual_maintenance_exposes_no_full_data_scans_or_repairs(self):
        workflow = (WORKFLOWS / "catalog-maintenance.yml").read_text(encoding="utf-8")
        self.assertIn("group: cloudflare-api", workflow)
        self.assertIn("cancel-in-progress: false", workflow)
        budget = workflow.index("run: python tools/check_d1_editorial_audit_budget.py")
        health = workflow.index("run: node tools/check_worker_health.mjs")
        schema = workflow.index("run: python tools/audit_d1_integrity.py --schema-only")
        self.assertLess(budget, health)
        self.assertLess(health, schema)
        for forbidden in (
            "run: python tools/audit_d1_integrity.py\n",
            "run: python tools/apply_legacy_gallery_repairs.py",
            "run: python tools/backfill_image_source_index.py",
            "confirm_expensive_d1_reads",
        ):
            with self.subTest(forbidden=forbidden):
                self.assertNotIn(forbidden, workflow)

    def test_no_automatic_full_integrity_audit(self):
        workflow = (WORKFLOWS / "cloudflare.yml").read_text(encoding="utf-8")
        self.assertIn("id: d1_scope", workflow)
        self.assertIn("run_d1_schema=false", workflow)
        self.assertIn("run: python tools/audit_d1_integrity.py --preflight-schema-readability", workflow)
        self.assertIn("run: python tools/audit_d1_integrity.py --schema-only", workflow)
        self.assertNotIn("run: python tools/audit_d1_integrity.py\n", workflow)
        self.assertLess(workflow.index("Apply D1 migrations"),
                        workflow.index("Verify D1 schema contract after migrations"))
        self.assertLess(workflow.index("Verify D1 schema contract after migrations"),
                        workflow.index("Register staged Worker at zero traffic"))
        self.assertIn("if: ${{ steps.d1_scope.outputs.run_d1_schema != 'true' }}", workflow)

    def test_deploy_uses_same_concurrency_group(self):
        workflow = (WORKFLOWS / "cloudflare.yml").read_text(encoding="utf-8")
        self.assertIn("group: cloudflare-api", workflow)
        self.assertIn("cancel-in-progress: false", workflow)


if __name__ == "__main__":
    unittest.main()
