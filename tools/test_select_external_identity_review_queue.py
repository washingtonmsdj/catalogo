from __future__ import annotations

import json
import tempfile
import unittest
from pathlib import Path

from select_external_identity_review_queue import select_next


def write(root: Path, filename: str, pid: int, *, identity: str, complete: bool = True,
          resolved: bool = False, approved: bool = False, candidates: int | None = None):
    row = {
        "sourceProductId": pid,
        "identityReview": {"decision": identity},
        "stagingEvidence": {"completeStaging": complete},
        "decision": {"identityResolved": resolved},
    }
    if candidates is not None:
        row["productionSearch"] = {"exactOrTextualCandidateCount": candidates}
    if identity == "map_existing":
        row["identityReview"].update({"targetModelId": "mdl_real", "mapExistingApproved": approved})
        row["decision"].update({"mapExistingAuthorized": approved, "galleryMediaReviewApproved": False})
    if identity == "new_model":
        row["decision"]["newModelIdentityAuthorized"] = approved
    (root / filename).write_text(json.dumps(row), encoding="utf-8")


class ReviewQueueTests(unittest.TestCase):
    def test_prioritizes_single_candidate_and_never_repeats_approved_identity(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            write(root, "external-source-001-alpha-identity-preflight-2026-10-16.json", 101,
                  identity="unresolved", candidates=2)
            write(root, "external-source-001-beta-identity-preflight-2026-10-16.json", 102,
                  identity="unresolved", candidates=1)
            write(root, "external-source-001-gamma-identity-preflight-2026-10-16.json", 103,
                  identity="unresolved", candidates=1)
            write(root, "external-source-001-gamma-visual-identity-resolution-2026-10-29.json", 103,
                  identity="map_existing", resolved=True, approved=True)
            self.assertEqual(select_next(root), [102, 101])
            self.assertEqual(select_next(root, 1), [102])

    def test_new_model_decision_is_not_resampled_despite_media_block(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            write(root, "external-source-001-a-identity-preflight-2026-10-16.json", 501,
                  identity="unresolved", candidates=1)
            write(root, "external-source-001-a-visual-identity-resolution-2026-10-29.json", 501,
                  identity="new_model", resolved=True, approved=True)
            self.assertEqual(select_next(root), [])

    def test_unapproved_mapping_does_not_remove_pending_from_queue(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            write(root, "external-source-001-a-identity-preflight-2026-10-16.json", 601,
                  identity="unresolved", candidates=1)
            write(root, "external-source-001-a-visual-identity-resolution-2026-10-29.json", 601,
                  identity="map_existing", resolved=True, approved=False)
            self.assertEqual(select_next(root), [601])

    def test_incomplete_staging_is_not_enqueued(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            write(root, "external-source-001-a-identity-preflight-2026-10-16.json", 701,
                  identity="unresolved", complete=False)
            self.assertEqual(select_next(root), [])

    def test_empty_evidence_is_valid_end_of_review_queue(self):
        with tempfile.TemporaryDirectory() as tmp:
            self.assertEqual(select_next(Path(tmp)), [])

    def test_limit_is_strict(self):
        with tempfile.TemporaryDirectory() as tmp:
            with self.assertRaises(ValueError):
                select_next(Path(tmp), 4)

    def test_malformed_candidate_data_fails_closed(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            (root / "external-source-001-a-identity-preflight-2026-10-16.json").write_text(
                "{", encoding="utf-8"
            )
            with self.assertRaises(RuntimeError):
                select_next(root)


if __name__ == "__main__":
    unittest.main()
