import unittest
from pathlib import Path


class PagesWorkflowConfigTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.workflow = (Path(__file__).resolve().parents[1] / ".github" / "workflows" / "pages.yml").read_text(encoding="utf-8")

    def test_production_runtime_values_come_from_repository_variables(self):
        required = [
            "VITE_API_BASE_URL: ${{ vars.VITE_API_BASE_URL }}",
            "VITE_MEDIA_BASE_URL: ${{ vars.VITE_MEDIA_BASE_URL }}",
            "VITE_TURNSTILE_SITE_KEY: ${{ vars.VITE_TURNSTILE_SITE_KEY }}",
            "VITE_PUBLIC_SITE_URL: ${{ vars.VITE_PUBLIC_SITE_URL }}",
        ]
        for entry in required:
            self.assertIn(entry, self.workflow)

    def test_pages_workflow_has_no_production_endpoint_fallbacks(self):
        forbidden = [
            "tonecos-catalogo-api.ordax-ac1ca1b50d09.workers.dev",
            "pub-1a55c50ce21d47bc9200eef58527ee4b.r2.dev",
            "0x4AAAAAAFKrlH5Vf65-ffVq",
            "${PUBLIC_SITE_URL:-",
        ]
        for value in forbidden:
            self.assertNotIn(value, self.workflow)

    def test_missing_runtime_configuration_fails_before_build(self):
        self.assertIn("Validate public runtime configuration", self.workflow)
        self.assertIn("Missing required Repository Variables", self.workflow)
        self.assertIn("exit 1", self.workflow)

    def test_published_brand_assets_are_validated_from_ssot(self):
        required = [
            "config/brand.json",
            'SHORT_NAME="$(node -e',
            'BRAND_INITIAL="$(node -e',
            "data.short_name !== expectedShort",
            'FAVICON_URL="${PAGE_URL%/}/favicon.svg"',
            'grep -Fq ">$BRAND_INITIAL</text>"',
        ]
        for entry in required:
            self.assertIn(entry, self.workflow)


if __name__ == "__main__":
    unittest.main()
