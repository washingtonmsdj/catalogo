import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
WORKFLOWS = ROOT / ".github" / "workflows"
DISPATCH_ONLY = (
    "exact-source-gallery-preflight.yml",
    "exact-source-gallery-promotion.yml",
    "existing-gallery-preflight.yml",
    "existing-gallery-promotion.yml",
    "external-batch-release.yml",
    "external-candidate-discovery.yml",
    "external-gallery-review.yml",
    "external-source-review.yml",
    "identity-visual-review.yml",
    "staged-perceptual-review.yml",
)


class ProductionReadSeparationTests(unittest.TestCase):
    def test_production_media_workflows_never_query_live_d1_on_pull_request(self):
        for name in DISPATCH_ONLY:
            with self.subTest(workflow=name):
                workflow = (WORKFLOWS / name).read_text(encoding="utf-8")
                triggers = workflow.split("permissions:", 1)[0]
                self.assertIn("  workflow_dispatch:", triggers)
                self.assertNotIn("  pull_request:", triggers)

    def test_unbounded_source_coverage_workflow_is_not_dispatchable(self):
        self.assertFalse((WORKFLOWS / "external-source-coverage.yml").exists())
        self.assertTrue((ROOT / "tools/audit_external_source_coverage.py").exists())
        self.assertTrue((ROOT / "tools/audit_published_sha_inventory.py").exists())

    def test_canonical_pr_ci_runs_full_python_contract_suite(self):
        workflow = (WORKFLOWS / "ci.yml").read_text(encoding="utf-8")
        self.assertIn("  pull_request:", workflow)
        self.assertIn("python -m unittest discover -s . -p 'test_*.py' -v", workflow)
        self.assertIn("set -o pipefail", workflow)
        self.assertNotIn("production-release", (WORKFLOWS / "external-batch-release.yml").read_text(encoding="utf-8"))
        self.assertNotIn("github.event_name == 'pull_request'", (WORKFLOWS / "external-candidate-discovery.yml").read_text(encoding="utf-8"))
        self.assertIn("python -m pip install -r tools/requirements.txt", workflow)

    def test_actual_publication_requires_explicit_dispatch(self):
        for name in ("external-batch-release.yml", "existing-gallery-promotion.yml", "exact-source-gallery-promotion.yml"):
            with self.subTest(workflow=name):
                workflow = (WORKFLOWS / name).read_text(encoding="utf-8")
                self.assertIn("github.event_name == 'workflow_dispatch'", workflow)


if __name__ == "__main__":
    unittest.main()
