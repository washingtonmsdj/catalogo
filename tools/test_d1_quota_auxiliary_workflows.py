#!/usr/bin/env python3
"""Fail-closed regression checks: optional D1 readers cannot bypass budget guard."""
from pathlib import Path
import unittest

ROOT = Path(__file__).resolve().parent.parent
WORKFLOWS = ROOT / ".github" / "workflows"
GUARD = "run: python tools/check_d1_editorial_audit_budget.py"

class D1AuxiliaryWorkflowQuotaContract(unittest.TestCase):
    def check(self, name, d1_steps, expected_guards):
        text = (WORKFLOWS / name).read_text(encoding="utf-8")
        self.assertIn("group: cloudflare-api", text, name)
        self.assertIn("cancel-in-progress: false", text, name)
        self.assertEqual(text.count(GUARD), expected_guards, name)
        for guard, d1 in d1_steps:
            self.assertLess(text.index(guard), text.index(d1), name)

    def test_external_batch(self):
        self.check("external-batch-release.yml", [
            ("Protect D1 quota before batch preflight", "D1 new-only production preflight"),
            ("Recheck D1 quota before batch release", "Re-check D1 new-only immediately before R2 write"),
            ("Recheck D1 quota before atomic model write", "Apply strictly new-only D1 delta atomically"),
        ], 3)

    def test_exact_source_gallery_promotion(self):
        self.check("exact-source-gallery-promotion.yml", [
            ("Protect D1 quota before exact-source promotion", "Require public verification endpoint before apply"),
        ], 1)

    def test_existing_gallery_promotion(self):
        self.check("existing-gallery-promotion.yml", [
            ("Protect D1 quota before gallery promotion", "Rebuild authorization and plan production delta"),
        ], 1)

    def test_exact_source_preflight(self):
        self.check("exact-source-gallery-preflight.yml", [
            ("Protect D1 quota before exact-source preflight", "Run approved exact-source preflights"),
        ], 1)

if __name__ == "__main__":
    unittest.main()
