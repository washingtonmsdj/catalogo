from __future__ import annotations

import json
import subprocess
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
BRAND_PATH = ROOT / "config" / "brand.json"
FORBIDDEN_MARKS = [
    ("stl" + "forge").encode("utf-8"),
    ("stl" + " forge").encode("utf-8"),
]


class BrandIdentityTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls.brand = json.loads(BRAND_PATH.read_text(encoding="utf-8"))

    def test_brand_definition_has_required_fields(self) -> None:
        for key in ("name", "shortName", "catalogLabel"):
            value = self.brand.get(key)
            self.assertIsInstance(value, str)
            self.assertTrue(value.strip(), f"config/brand.json: {key} vazio")

    def test_competitor_name_is_absent_from_every_tracked_file(self) -> None:
        result = subprocess.run(
            ["git", "ls-files", "-z", "--cached", "--others", "--exclude-standard"],
            cwd=ROOT,
            check=True,
            capture_output=True,
        )
        offenders: list[str] = []
        for raw_name in result.stdout.split(b"\0"):
            if not raw_name:
                continue
            relative = raw_name.decode("utf-8")
            path = ROOT / relative
            if not path.is_file():
                continue
            data = path.read_bytes().lower()
            if any(mark in data for mark in FORBIDDEN_MARKS):
                offenders.append(relative)
        self.assertEqual(offenders, [], f"identidade concorrente encontrada em: {offenders}")

    def test_runtime_sources_do_not_hardcode_current_brand_name(self) -> None:
        needle = self.brand["name"].encode("utf-8").lower()
        offenders: list[str] = []
        for pattern in ("*.ts", "*.tsx"):
            for path in (ROOT / "src").rglob(pattern):
                if needle in path.read_bytes().lower():
                    offenders.append(str(path.relative_to(ROOT)))
        self.assertEqual(offenders, [], f"marca hardcoded fora do SSOT: {offenders}")

    def test_current_brand_literal_exists_only_in_ssot(self) -> None:
        needle = self.brand["name"].encode("utf-8").lower()
        result = subprocess.run(
            ["git", "ls-files", "-z", "--cached", "--others", "--exclude-standard"],
            cwd=ROOT,
            check=True,
            capture_output=True,
        )
        offenders: list[str] = []
        for raw_name in result.stdout.split(b"\0"):
            if not raw_name:
                continue
            relative = raw_name.decode("utf-8")
            if relative == "config/brand.json":
                continue
            path = ROOT / relative
            if path.is_file() and needle in path.read_bytes().lower():
                offenders.append(relative)
        self.assertEqual(offenders, [], f"literal da marca fora do SSOT: {offenders}")

    def test_static_metadata_is_generated_from_brand_ssot(self) -> None:
        index = (ROOT / "index.html").read_text(encoding="utf-8")
        vite = (ROOT / "vite.config.ts").read_text(encoding="utf-8")
        workflow = (ROOT / ".github" / "workflows" / "pages.yml").read_text(encoding="utf-8")

        self.assertIn("__BRAND_NAME__", index)
        self.assertIn("__CATALOG_PAGE_TITLE__", index)
        self.assertNotIn(self.brand["name"], index)
        self.assertIn("import brand from './config/brand.json'", vite)
        self.assertIn("fileName: 'site.webmanifest'", vite)
        self.assertIn("config/brand.json", workflow)
        self.assertFalse((ROOT / "public" / "site.webmanifest").exists())


if __name__ == "__main__":
    unittest.main()
