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

    def test_manual_maintenance_needs_explicit_approval_and_safe_default(self):
        workflow = (WORKFLOWS / "catalog-maintenance.yml").read_text(encoding="utf-8")
        self.assertIn("default: verify-public-hierarchy", workflow)
        self.assertIn("confirm_expensive_d1_reads:", workflow)
        self.assertIn("type: boolean", workflow)
        self.assertIn("default: false", workflow)
        consent = workflow.index("Require explicit consent for expensive D1 maintenance")
        health = workflow.index("Validate active Worker health and schema")
        budget = workflow.index("Reserve D1 quota before database maintenance")
        audit = workflow.index("Audit D1 structural integrity")
        self.assertLess(consent, health)
        self.assertLess(health, budget)
        self.assertLess(budget, audit)
        self.assertIn("if [ \"$EXPLICIT_CONSENT\" != 'true' ]; then", workflow)
        self.assertIn("EXPLICIT_CONSENT: ${{ inputs.confirm_expensive_d1_reads }}", workflow)

    def test_runtime_only_deploy_skips_expensive_full_d1_audit(self):
        workflow = (WORKFLOWS / "cloudflare.yml").read_text(encoding="utf-8")
        self.assertIn("id: d1_scope", workflow)
        self.assertIn("run_d1_schema=false", workflow)
        self.assertIn("run: python tools/audit_d1_integrity.py --preflight-schema-readability", workflow)
        self.assertEqual(workflow.count("run: python tools/audit_d1_integrity.py\n"), 1)
        full_audit = (
            "- name: Audit D1 structural integrity after schema changes\n"
            "        if: ${{ steps.d1_scope.outputs.run_d1_schema == 'true' }}\n"
            "        run: python tools/audit_d1_integrity.py"
        )
        self.assertIn(full_audit, workflow)
        self.assertLess(workflow.index("Apply D1 migrations"), workflow.index(full_audit))
        self.assertLess(workflow.index(full_audit),
                        workflow.index("Register staged Worker at zero traffic"))
        self.assertIn("if: ${{ steps.d1_scope.outputs.run_d1_schema != 'true' }}", workflow)

    def test_deploy_uses_same_concurrency_group(self):
        workflow = (WORKFLOWS / "cloudflare.yml").read_text(encoding="utf-8")
        self.assertIn("group: cloudflare-api", workflow)
        self.assertIn("cancel-in-progress: false", workflow)


if __name__ == "__main__":
    unittest.main()
