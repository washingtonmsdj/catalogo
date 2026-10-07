import json
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]


class CloudflareWorkflowConfigTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.workflow = (ROOT / ".github" / "workflows" / "cloudflare.yml").read_text(encoding="utf-8")
        cls.wrangler = json.loads((ROOT / "wrangler.jsonc").read_text(encoding="utf-8"))

    def test_preflight_fails_closed_when_deployment_credentials_are_missing(self):
        self.assertIn("API_TOKEN: ${{ secrets.CLOUDFLARE_API_TOKEN }}", self.workflow)
        self.assertIn("TURNSTILE_SECRET: ${{ secrets.TURNSTILE_SECRET_KEY }}", self.workflow)
        self.assertIn("missing+=(CLOUDFLARE_API_TOKEN)", self.workflow)
        self.assertIn("missing+=(TURNSTILE_SECRET_KEY)", self.workflow)
        self.assertIn("echo 'ready=false'", self.workflow)
        self.assertIn("::error::Deploy Cloudflare bloqueado", self.workflow)
        self.assertIn("credencial ausente é falha de deploy", self.workflow)
        self.assertIn("exit 1", self.workflow)

    def test_deploy_still_requires_secrets_when_preflight_is_ready(self):
        self.assertIn("CLOUDFLARE_API_TOKEN: ${{ secrets.CLOUDFLARE_API_TOKEN }}", self.workflow)
        self.assertIn("TURNSTILE_SECRET_KEY: ${{ secrets.TURNSTILE_SECRET_KEY }}", self.workflow)
        self.assertIn("Validate deployment credentials", self.workflow)

    def test_legacy_gallery_repairs_are_explicit_opt_in_after_schema_health(self):
        self.assertIn("apply_legacy_gallery_repairs:", self.workflow)
        self.assertIn("default: false", self.workflow)
        self.assertIn("Verify Worker schema health", self.workflow)
        self.assertIn("Plan reviewed legacy gallery repairs", self.workflow)
        self.assertIn("Apply reviewed legacy gallery repairs", self.workflow)
        self.assertIn(
            "github.event_name == 'workflow_dispatch' && inputs.apply_legacy_gallery_repairs",
            self.workflow,
        )
        self.assertLess(
            self.workflow.index("Verify Worker schema health"),
            self.workflow.index("Apply reviewed legacy gallery repairs"),
        )

    def test_sha_backfill_is_explicit_opt_in_and_requires_media_url_only_when_requested(self):
        self.assertIn("backfill_image_source_index:", self.workflow)
        self.assertIn("BACKFILL_SHA:", self.workflow)
        self.assertIn("missing+=(VITE_MEDIA_BASE_URL)", self.workflow)
        self.assertIn("Measure image SHA index coverage", self.workflow)
        self.assertIn("Backfill image SHA index", self.workflow)
        self.assertIn(
            "github.event_name == 'workflow_dispatch' && inputs.backfill_image_source_index",
            self.workflow,
        )
        self.assertIn("python tools/backfill_image_source_index.py --apply", self.workflow)

    def test_deploy_watches_schema_and_repair_contract_files(self):
        for path in (
            "config/catalog-schema-contract.json",
            "config/catalog-legacy-gallery-overrides.json",
            "tools/check_worker_health.mjs",
            "tools/apply_legacy_gallery_repairs.py",
            "tools/backfill_image_source_index.py",
        ):
            self.assertIn(path, self.workflow)

    def test_worker_preview_urls_are_explicitly_disabled(self):
        self.assertIs(self.wrangler.get("preview_urls"), False)


if __name__ == "__main__":
    unittest.main()
