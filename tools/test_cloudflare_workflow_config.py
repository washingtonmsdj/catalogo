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
        self.assertIn("missing+=(VITE_API_BASE_URL)", self.workflow)
        self.assertIn("echo 'ready=false'", self.workflow)
        self.assertIn("::error::Deploy Cloudflare bloqueado", self.workflow)
        self.assertIn("credencial ausente é falha de deploy", self.workflow)
        self.assertIn("exit 1", self.workflow)

    def test_deploy_still_requires_secrets_when_preflight_is_ready(self):
        self.assertIn("CLOUDFLARE_API_TOKEN: ${{ secrets.CLOUDFLARE_API_TOKEN }}", self.workflow)
        self.assertIn("TURNSTILE_SECRET_KEY: ${{ secrets.TURNSTILE_SECRET_KEY }}", self.workflow)
        self.assertIn("Validate deployment credentials", self.workflow)
        self.assertEqual(
            ["TURNSTILE_SECRET_KEY"],
            self.wrangler.get("secrets", {}).get("required"),
        )

    def test_d1_database_id_is_versioned_ssot_not_repository_variable(self):
        databases = self.wrangler.get("d1_databases")
        self.assertIsInstance(databases, list)
        self.assertEqual(1, len(databases))
        self.assertEqual("DB", databases[0].get("binding"))
        database_id = str(databases[0].get("database_id") or "")
        self.assertNotEqual("REPLACE_AFTER_D1_CREATE", database_id)
        self.assertRegex(
            database_id,
            r"^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$",
        )
        self.assertNotIn("vars.CLOUDFLARE_D1_DATABASE_ID", self.workflow)
        self.assertNotIn("missing+=(CLOUDFLARE_D1_DATABASE_ID)", self.workflow)

    def test_deploy_exports_canonical_d1_binding_before_render_and_migrations(self):
        self.assertIn("Export canonical D1 binding", self.workflow)
        self.assertIn("node tools/read_wrangler_d1_id.mjs", self.workflow)
        self.assertIn('CLOUDFLARE_D1_DATABASE_ID=$database_id', self.workflow)
        self.assertLess(self.workflow.index("Export canonical D1 binding"), self.workflow.index("Render production config"))
        self.assertLess(self.workflow.index("Export canonical D1 binding"), self.workflow.index("Apply D1 migrations"))

    def test_turnstile_secret_is_staged_atomically_without_implicit_deploy(self):
        self.assertNotIn("npx wrangler secret put", self.workflow)
        self.assertNotIn("force_turnstile_secret_sync", self.workflow)
        self.assertIn("tonecos-worker-secrets.json", self.workflow)
        self.assertIn("--secrets-file \"$secrets_file\"", self.workflow)
        self.assertIn("trap 'rm -f \"$secrets_file\"' EXIT", self.workflow)
        self.assertIn("TURNSTILE_SECRET_KEY: process.env.TURNSTILE_SECRET_KEY", self.workflow)

    def test_previous_production_version_is_captured_before_any_worker_write(self):
        self.assertIn("Capture current production Worker version", self.workflow)
        self.assertIn("node tools/cloudflare_deploy_state.mjs active-version", self.workflow)
        self.assertIn("PREVIOUS_WORKER_VERSION_ID=$previous_version", self.workflow)
        self.assertLess(
            self.workflow.index("Capture current production Worker version"),
            self.workflow.index("Upload Worker version with required secret and no traffic"),
        )

    def test_staged_worker_version_is_captured_from_structured_wrangler_output(self):
        self.assertIn("WRANGLER_OUTPUT_FILE_PATH:", self.workflow)
        self.assertIn("wrangler-version-upload.ndjson", self.workflow)
        self.assertIn("Capture staged Worker version", self.workflow)
        self.assertIn("cloudflare_deploy_state.mjs uploaded-version", self.workflow)
        self.assertIn("STAGED_WORKER_VERSION_ID=$staged_version", self.workflow)
        self.assertLess(
            self.workflow.index("Upload Worker version with required secret and no traffic"),
            self.workflow.index("Capture staged Worker version"),
        )

    def test_staged_smoke_runs_after_expand_migrations_and_before_promotion(self):
        self.assertIn("Smoke staged Worker version before promotion", self.workflow)
        self.assertIn("check_staged_worker_version.mjs", self.workflow)
        self.assertLess(self.workflow.index("Validate migration-first compatibility"), self.workflow.index("Apply D1 migrations"))
        self.assertLess(self.workflow.index("Apply D1 migrations"), self.workflow.index("Smoke staged Worker version before promotion"))
        self.assertLess(self.workflow.index("Smoke staged Worker version before promotion"), self.workflow.index("Promote staged Worker version"))

    def test_worker_promotion_is_explicit_and_only_after_staged_smoke(self):
        self.assertIn("WORKER_VERSION_TAG: ci-${{ github.run_id }}-${{ github.run_attempt }}", self.workflow)
        self.assertIn("npx wrangler versions upload", self.workflow)
        self.assertIn('--tag "$WORKER_VERSION_TAG"', self.workflow)
        self.assertIn("--strict", self.workflow)
        self.assertIn("Promote staged Worker version", self.workflow)
        self.assertIn("id: promote", self.workflow)
        self.assertIn("npx wrangler versions deploy", self.workflow)
        self.assertIn('--version-tag "${WORKER_VERSION_TAG}@100%"', self.workflow)
        self.assertIn("--yes", self.workflow)
        self.assertNotIn("npx wrangler deploy --config .wrangler.deploy.jsonc", self.workflow)

    def test_failed_post_promotion_smoke_rolls_back_explicit_previous_version(self):
        self.assertIn("Roll back Worker after failed production smoke", self.workflow)
        self.assertIn("failure() && steps.promote.outcome == 'success'", self.workflow)
        self.assertIn('npx wrangler rollback "$PREVIOUS_WORKER_VERSION_ID"', self.workflow)
        rollback = self.workflow.index("Roll back Worker after failed production smoke")
        for smoke in (
            "Verify Worker schema health",
            "Verify D1 readiness through catalog API",
            "Verify recent catalog route",
            "Verify gallery contract through catalog API",
            "Verify shared collections route",
        ):
            self.assertLess(self.workflow.index(smoke), rollback)
        self.assertLess(rollback, self.workflow.index("Audit D1 structural integrity"))

    def test_migration_policy_gate_runs_before_remote_migrations(self):
        self.assertIn("Validate migration-first compatibility", self.workflow)
        self.assertIn("python tools/check_migration_deploy_policy.py", self.workflow)
        self.assertLess(self.workflow.index("Validate migration-first compatibility"), self.workflow.index("Apply D1 migrations"))

    def test_legacy_gallery_repairs_are_explicit_opt_in_after_schema_health(self):
        self.assertIn("apply_legacy_gallery_repairs:", self.workflow)
        self.assertIn("default: false", self.workflow)
        self.assertIn("Verify Worker schema health", self.workflow)
        self.assertIn("Plan reviewed legacy gallery repairs", self.workflow)
        self.assertIn("Apply reviewed legacy gallery repairs", self.workflow)
        self.assertIn("github.event_name == 'workflow_dispatch' && inputs.apply_legacy_gallery_repairs", self.workflow)
        self.assertLess(self.workflow.index("Verify Worker schema health"), self.workflow.index("Apply reviewed legacy gallery repairs"))

    def test_sha_backfill_precedes_legacy_repair_apply(self):
        self.assertLess(self.workflow.index("Backfill image SHA index"), self.workflow.index("Apply reviewed legacy gallery repairs"))
        self.assertLess(self.workflow.index("Measure image SHA index coverage"), self.workflow.index("Apply reviewed legacy gallery repairs"))

    def test_legacy_repair_apply_is_followed_by_public_alias_smoke(self):
        self.assertIn("Verify repaired legacy aliases through public API", self.workflow)
        self.assertIn("node tools/check_legacy_gallery_repairs.mjs", self.workflow)
        self.assertIn("inputs.apply_legacy_gallery_repairs", self.workflow)
        self.assertLess(self.workflow.index("Apply reviewed legacy gallery repairs"), self.workflow.index("Verify repaired legacy aliases through public API"))

    def test_d1_integrity_audit_runs_before_and_after_legacy_repairs(self):
        self.assertIn("Audit D1 structural integrity", self.workflow)
        self.assertIn("Re-audit D1 after legacy repairs", self.workflow)
        self.assertIn("python tools/audit_d1_integrity.py", self.workflow)
        self.assertLess(self.workflow.index("Verify Worker schema health"), self.workflow.index("Audit D1 structural integrity"))
        self.assertLess(self.workflow.index("Audit D1 structural integrity"), self.workflow.index("Apply reviewed legacy gallery repairs"))
        self.assertLess(self.workflow.index("Apply reviewed legacy gallery repairs"), self.workflow.index("Re-audit D1 after legacy repairs"))

    def test_sha_backfill_is_explicit_opt_in_and_requires_media_url_only_when_requested(self):
        self.assertIn("backfill_image_source_index:", self.workflow)
        self.assertIn("BACKFILL_SHA:", self.workflow)
        self.assertIn("missing+=(VITE_MEDIA_BASE_URL)", self.workflow)
        self.assertIn("Measure image SHA index coverage", self.workflow)
        self.assertIn("Backfill image SHA index", self.workflow)
        self.assertIn("github.event_name == 'workflow_dispatch' && inputs.backfill_image_source_index", self.workflow)
        self.assertIn("python tools/backfill_image_source_index.py --apply", self.workflow)

    def test_deploy_watches_schema_and_runtime_contract_files(self):
        for path in (
            "config/catalog-schema-contract.json",
            "config/migration-deploy-policy.json",
            "config/catalog-legacy-gallery-overrides.json",
            "tools/wrangler_config_contract.mjs",
            "tools/read_wrangler_d1_id.mjs",
            "tools/cloudflare_deploy_state.mjs",
            "tools/check_staged_worker_version.mjs",
            "tools/check_migration_deploy_policy.py",
            "tools/check_worker_health.mjs",
            "tools/check_legacy_gallery_repairs.mjs",
            "tools/apply_legacy_gallery_repairs.py",
            "tools/backfill_image_source_index.py",
            "tools/audit_d1_integrity.py",
        ):
            self.assertIn(path, self.workflow)

    def test_worker_preview_urls_are_explicitly_disabled(self):
        self.assertIs(self.wrangler.get("preview_urls"), False)


if __name__ == "__main__":
    unittest.main()
