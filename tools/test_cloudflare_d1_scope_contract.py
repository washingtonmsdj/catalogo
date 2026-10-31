import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
WORKFLOW = ROOT / ".github" / "workflows" / "cloudflare.yml"


def step_block(workflow: str, name: str) -> str:
    marker = f"      - name: {name}\n"
    start = workflow.index(marker)
    next_step = workflow.find("      - name: ", start + len(marker))
    if next_step == -1:
        next_step = len(workflow)
    return workflow[start:next_step]


class CloudflareD1ScopeContractTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.workflow = WORKFLOW.read_text(encoding="utf-8")

    def test_schema_scope_is_derived_from_canonical_paths(self):
        self.assertIn("Detect D1 schema change scope", self.workflow)
        self.assertIn("fetch-depth: 0", self.workflow)
        self.assertIn(
            'git diff --quiet "$before" "$GITHUB_SHA" -- migrations config/catalog-schema-contract.json',
            self.workflow,
        )
        self.assertIn("if [ \"$GITHUB_EVENT_NAME\" = 'workflow_dispatch' ]", self.workflow)
        self.assertIn("run_d1_schema=true", self.workflow)
        self.assertIn('echo "run_d1_schema=$run_d1_schema" >> "$GITHUB_OUTPUT"', self.workflow)

    def test_migrations_are_skipped_for_runtime_only_pushes(self):
        block = step_block(self.workflow, "Apply D1 migrations")
        self.assertIn("steps.d1_scope.outputs.run_d1_schema == 'true'", block)
        self.assertIn("wrangler d1 migrations apply DB --remote", block)

    def test_schema_release_checks_d1_budget_before_upload_and_migrations(self):
        budget = step_block(self.workflow, "Protect D1 quota before schema-changing release")
        self.assertIn("steps.d1_scope.outputs.run_d1_schema == 'true'", budget)
        self.assertIn("python tools/check_d1_editorial_audit_budget.py", budget)
        self.assertLess(self.workflow.index("Protect D1 quota before schema-changing release"),
                        self.workflow.index("Verify canonical D1 schema queries before uploading any Worker version"))
        self.assertIn("steps.d1_scope.outputs.run_d1_schema == 'true'",
                      step_block(self.workflow, "Verify canonical D1 schema queries before uploading any Worker version"))
        self.assertLess(self.workflow.index("Protect D1 quota before schema-changing release"),
                        self.workflow.index("Upload Worker version with required secret and no traffic"))
        self.assertLess(self.workflow.index("Protect D1 quota before schema-changing release"),
                        self.workflow.index("Apply D1 migrations"))

    def test_schema_only_after_migrations_uses_budget_and_no_data_scan(self):
        recheck = step_block(self.workflow, "Recheck D1 quota before bounded schema validation")
        self.assertIn("steps.d1_scope.outputs.run_d1_schema == 'true'", recheck)
        self.assertIn("python tools/check_d1_editorial_audit_budget.py", recheck)
        gate = step_block(self.workflow, "Verify D1 schema contract after migrations")
        self.assertIn("python tools/audit_d1_integrity.py --schema-only", gate)
        self.assertLess(self.workflow.index("Apply D1 migrations"),
                        self.workflow.index("Recheck D1 quota before bounded schema validation"))
        self.assertLess(self.workflow.index("Recheck D1 quota before bounded schema validation"),
                        self.workflow.index("Verify D1 schema contract after migrations"))
        self.assertLess(self.workflow.index("Verify D1 schema contract after migrations"),
                        self.workflow.index("Register staged Worker at zero traffic"))
        self.assertNotIn("run: python tools/audit_d1_integrity.py\n", self.workflow)
        self.assertNotIn("- 'tools/audit_d1_integrity.py'", self.workflow)
        self.assertIn("'tools/catalog_schema_contract.py'", self.workflow)

    def test_release_smoke_remains_unconditional_after_optional_schema_work(self):
        block = step_block(self.workflow, "Verify promoted Worker deployment and full public release")
        self.assertNotIn("steps.d1_scope.outputs.run_d1_schema", block)
        self.assertIn("check_promoted_worker_version.mjs", block)

    def test_cache_hit_proof_runs_inside_rollback_window(self):
        release_gate = "Verify promoted Worker deployment and full public release"
        cache_gate = "Verify Workers Cache hit after promotion"
        restore = "Restore previous Worker after failed staged or production smoke"

        self.assertIn(cache_gate, self.workflow)
        cache_block = step_block(self.workflow, cache_gate)
        self.assertIn("check_worker_cache_hit.mjs", cache_block)
        self.assertGreaterEqual(self.workflow.count("tools/check_worker_cache_hit.mjs"), 2)
        self.assertLess(self.workflow.index(release_gate), self.workflow.index(cache_gate))
        self.assertLess(self.workflow.index(cache_gate), self.workflow.index(restore))


if __name__ == "__main__":
    unittest.main()
