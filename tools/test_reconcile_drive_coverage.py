import copy
import unittest

from reconcile_drive_coverage import DriveReconciliationError, reconcile


def source():
    products = [
        {"sourceProductId": 10, "sourceSlug": "a", "sourceName": "A",
         "state": "confirmed_present_map_existing", "candidateMetadataSemantics": "review_only"},
        {"sourceProductId": 11, "sourceSlug": "b", "sourceName": "B",
         "state": "unreviewed_no_exact_name_candidate", "candidateMetadataSemantics": "review_only"},
        {"sourceProductId": 12, "sourceSlug": "c-new", "sourceName": "C",
         "state": "unreviewed_single_exact_name_candidate", "candidateMetadataSemantics": "review_only",
         "exactNameCandidates": [{"modelId": "mdl_old"}]},
    ]
    return {"sourceId": "external-source-001",
            "summary": {"sourceProducts": 3, "publishedModels": 5,
                        "confirmedPresent": 1, "coverage100Proven": False,
                        "states": {"confirmed_present_map_existing": 1,
                                   "unreviewed_no_exact_name_candidate": 1,
                                   "unreviewed_single_exact_name_candidate": 1},
                        "candidateMetadataSemantics": "review_only",
                        "productionWrites": 0, "stagingWrites": 0},
            "products": products}


def row(state, pid, slug, sha="a" * 64):
    return {"status": state, "post_id": pid, "slug": slug, "sha256": sha}


def report(data=None, rows=None):
    return reconcile(data or source(),
                     rows if rows is not None else [
                         row("COBERTO_CATALOGO_SHA", "11", "b"),
                         row("REVISAO_VISUAL_COBERTURA", "12", "c-old"),
                         row("EM_NOVOS_SHA", "", "a"),
                     ], legacy_export_sha256="b" * 64, legacy_as_of="2026-08-22")


class DriveEvidenceTests(unittest.TestCase):
    def test_all_historical_rows_processed_without_auto_approvals(self):
        z = report()
        self.assertEqual(z["summary"]["historicalDriveProducts"], 3)
        self.assertEqual(z["summary"]["historicalDriveProductsRequiringReconciliation"], 2)
        self.assertEqual(z["summary"]["alreadyConfirmedWithinDriveCohort"], 1)
        self.assertEqual(z["summary"]["linkageCounts"],
                         {"id_and_slug": 1, "id_slug_changed": 1, "slug_only": 1})
        self.assertEqual(z["workItems"][0]["legacyDriveStatus"], "COBERTO_CATALOGO_SHA")
        self.assertTrue(all(not x["identityApprovedByThisReport"] and not x["mediaPromotionAuthorized"]
                            and not x["imagePresentInCurrentD1Proven"] for x in z["workItems"]))
        self.assertEqual(z["summary"]["imagesDownloaded"], 0)

    def test_source_id_and_slug_disagreement_is_blocked(self):
        with self.assertRaisesRegex(DriveReconciliationError, "conflicting current"):
            report(rows=[row("COBERTO_CATALOGO_SHA", "11", "a")])

    def test_duplicate_and_untrusted_records_fail_closed(self):
        good = row("COBERTO_CATALOGO_SHA", "11", "b")
        for bad in [
            [good, good],
            [row("UNAPPROVED", "11", "b")],
            [row("COBERTO_CATALOGO_SHA", "11", "b", "bad")],
            [row("COBERTO_CATALOGO_SHA", "true", "b")],
            [row("COBERTO_CATALOGO_SHA", "11", "")],
        ]:
            with self.subTest(rows=bad), self.assertRaises(DriveReconciliationError):
                report(rows=bad)

    def test_historical_missing_link_never_means_new_sculpture(self):
        z = report(rows=[row("EM_NOVOS_SHA", "", "not-in-current-source")])
        self.assertEqual(z["workItems"][0]["sourceLinkage"], "not_found")
        self.assertIsNone(z["workItems"][0]["currentSourceProductId"])
        self.assertFalse(z["workItems"][0]["sameSculptureProvenByDriveSha"])

    def test_current_source_summary_validation_reused(self):
        data = source()
        data["summary"]["confirmedPresent"] = 0
        with self.assertRaises(ValueError):
            report(data=data)

    def test_no_drive_paths_or_names_leak_into_review_output(self):
        r = row("COBERTO_CATALOGO_SHA", "11", "b")
        r["imagem_privada"] = r"C:\Users\PRIVATE\picture.jpg"
        r["novos_sha_paths"] = r"G:\Meu Drive\hidden.jpg"
        z = report(rows=[r])
        self.assertNotIn("PRIVATE", str(z))
        self.assertNotIn("hidden.jpg", str(z))


if __name__ == "__main__":
    unittest.main()
