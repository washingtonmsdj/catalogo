import copy
import json
import re
import unittest
from pathlib import Path

from reconcile_drive_coverage import (DriveReconciliationError, reconcile, build_operator_review_template,
                                     render_operator_approved_evidence)


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
    def test_committed_small_gallery_cohort_preserves_existing_production_identities(self):
        """A dated gallery review cannot silently become 14 newly published models.

        This reads only version-controlled, pinned local artifacts: no D1, R2,
        public API requests, image downloads, or editorial approvals.
        """
        root = Path(__file__).resolve().parents[1]
        cohort = json.loads(
            (root / "config/review-cohorts/drive-small-galleries-20261030.json")
            .read_text(encoding="utf-8")
        )
        contract = json.loads(
            (root / "config/catalog-production-model-contract.json")
            .read_text(encoding="utf-8")
        )
        self.assertEqual(cohort["version"], 1)
        self.assertEqual(cohort["kind"], "historical_drive_small_gallery_review_cohort")
        self.assertEqual(cohort["asOf"], "2026-10-30")
        self.assertIs(cohort["identityApproved"], False)
        self.assertIs(cohort["mediaPromotionAuthorized"], False)
        self.assertEqual(contract["version"], 1)
        self.assertEqual(contract["source"]["productionModels"], len(contract["models"]))
        self.assertEqual(
            contract["source"]["publishedModels"],
            sum(model["published"] == 1 for model in contract["models"]),
        )
        self.assertGreater(cohort["asOf"], contract["capturedAt"])
        by_id = {model["id"]: model for model in contract["models"]}
        self.assertEqual(len(by_id), len(contract["models"]))
        source_ids = set()
        target_ids = set()
        self.assertGreater(len(cohort["items"]), 0)
        for entry in cohort["items"]:
            self.assertEqual(
                set(entry),
                {"sourceProductId", "targetModelId", "expectedSourceImageCount", "sourceSlugSha256"},
            )
            self.assertIs(type(entry["sourceProductId"]), int)
            self.assertGreater(entry["sourceProductId"], 0)
            self.assertNotIn(entry["sourceProductId"], source_ids)
            source_ids.add(entry["sourceProductId"])
            self.assertNotIn(entry["targetModelId"], target_ids)
            target_ids.add(entry["targetModelId"])
            self.assertIn(entry["targetModelId"], by_id)
            self.assertEqual(by_id[entry["targetModelId"]]["published"], 1)
            self.assertIn(entry["expectedSourceImageCount"], (2, 3, 4))
            self.assertRegex(entry["sourceSlugSha256"], r"^[0-9a-f]{64}$")

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

    def test_published_sha_candidate_is_not_automatic_identity(self):
        index = {"version": 1, "scope": "active_published_gallery_source_sha_read_only",
                 "summary": {"publishedModels": 5, "indexedModels": 1,
                             "indexedImageRows": 1, "modelsWithoutIndex": 4,
                             "allPublishedModelsIndexed": False},
                 "modelShaPairs": [{"sourceSha256": "a" * 64, "modelId": "mdl_" + "1" * 20}],
                 "identityApproved": False, "mediaPromotionAuthorized": False,
                 "missingShaProvesMissingSculpture": False,
                 "sourceShaProvesSculptureIdentity": False,
                 "productionWrites": 0, "stagingWrites": 0, "imageBinariesDownloaded": 0}
        z = reconcile(source(), [row("COBERTO_CATALOGO_SHA", "11", "b")],
                      legacy_export_sha256="b" * 64, legacy_as_of="2026-08-22",
                      active_sha_index=index)
        self.assertEqual(z["summary"]["unconfirmedWithActiveGalleryShaCandidate"], 1)
        item = z["workItems"][0]
        self.assertEqual(item["shaCandidateModelIds"], ["mdl_" + "1" * 20])
        self.assertTrue(item["shaIndexedInActivePublishedGallery"])
        self.assertFalse(item["identityApprovedByThisReport"])
        self.assertFalse(item["mediaPromotionAuthorized"])

    def test_missing_sha_must_not_mean_new_sculpture(self):
        index = {"version": 1, "scope": "active_published_gallery_source_sha_read_only",
                 "summary": {"publishedModels": 5, "indexedModels": 0,
                             "indexedImageRows": 0, "modelsWithoutIndex": 5,
                             "allPublishedModelsIndexed": False},
                 "modelShaPairs": [], "identityApproved": False,
                 "mediaPromotionAuthorized": False,
                 "missingShaProvesMissingSculpture": False,
                 "sourceShaProvesSculptureIdentity": False,
                 "productionWrites": 0, "stagingWrites": 0, "imageBinariesDownloaded": 0}
        z = reconcile(source(), [row("EM_NOVOS_SHA", "", "none")],
                      legacy_export_sha256="b" * 64, legacy_as_of="2026-08-22",
                      active_sha_index=index)
        self.assertEqual(z["summary"]["unconfirmedWithActiveGalleryShaCandidate"], 0)
        self.assertFalse(z["workItems"][0]["sameSculptureProvenByDriveSha"])

    def test_malformed_sha_index_rejected(self):
        index = {"version": 1, "scope": "active_published_gallery_source_sha_read_only",
                 "summary": {"publishedModels": 5, "indexedModels": 1,
                             "indexedImageRows": 1, "modelsWithoutIndex": 4,
                             "allPublishedModelsIndexed": False},
                 "modelShaPairs": [{"sourceSha256": "invalid", "modelId": "mdl_" + "1" * 20}],
                 "identityApproved": False, "mediaPromotionAuthorized": False,
                 "missingShaProvesMissingSculpture": False,
                 "sourceShaProvesSculptureIdentity": False,
                 "productionWrites": 0, "stagingWrites": 0, "imageBinariesDownloaded": 0}
        with self.assertRaises(DriveReconciliationError):
            reconcile(source(), [row("COBERTO_CATALOGO_SHA", "11", "b")],
                      legacy_export_sha256="b" * 64, legacy_as_of="2026-08-22",
                      active_sha_index=index)

    def test_review_tiers_use_current_metadata_without_approving_identity(self):
        mid = "mdl_" + "1" * 20
        index = {"version": 1, "scope": "active_published_gallery_source_sha_read_only",
                 "summary": {"publishedModels": 5, "indexedModels": 1,
                             "indexedImageRows": 1, "modelsWithoutIndex": 4,
                             "allPublishedModelsIndexed": False},
                 "modelShaPairs": [{"sourceSha256": "a" * 64, "modelId": mid}],
                 "identityApproved": False, "mediaPromotionAuthorized": False,
                 "missingShaProvesMissingSculpture": False,
                 "sourceShaProvesSculptureIdentity": False,
                 "productionWrites": 0, "stagingWrites": 0, "imageBinariesDownloaded": 0}
        metadata = [
            {"id": "mdl_" + str(i) * 20, "name": "Esdeath" if i == 1 else "Other",
             "franchise_name": "Akame ga Kill" if i == 1 else "Other", "slug": str(i)}
            for i in range(1, 6)
        ]
        legacy = row("COBERTO_CATALOGO_SHA", "11", "b")
        legacy["personagem"] = "Esdeath"
        legacy["franquia"] = "Akame Ga Kill"
        data = reconcile(source(), [legacy], legacy_export_sha256="b" * 64,
                         legacy_as_of="2026-08-22", active_sha_index=index,
                         published_models=metadata)
        item = data["workItems"][0]
        self.assertEqual(item["shaReviewTier"], "A_exact_name_and_franchise")
        self.assertEqual(item["publishedModelName"], "Esdeath")
        self.assertFalse(item["identityApprovedByThisReport"])
        self.assertEqual(data["summary"]["shaReviewTierCounts"]["A_exact_name_and_franchise"], 1)

        legacy["personagem"] = "Another unrelated name"
        mismatch = reconcile(source(), [legacy], legacy_export_sha256="b" * 64,
                             legacy_as_of="2026-08-22", active_sha_index=index,
                             published_models=metadata)
        self.assertEqual(mismatch["workItems"][0]["shaReviewTier"],
                         "C_metadata_difference_requires_visual_review")

    def test_source_gallery_count_classifies_full_gallery_review_work(self):
        for images, expected in (
            (1, "single_source_image_historical_sha_not_currently_rehashed"),
            (5, "multiple_source_images_require_full_gallery_identity_review"),
            (0, "source_gallery_empty"),
            (None, "no_current_gallery_metadata"),
        ):
            data = source()
            data["products"][1]["sourceGalleryImageCount"] = images
            row_data = row("COBERTO_CATALOGO_SHA", "11", "b")
            with self.subTest(image_count=images):
                result = reconcile(data, [row_data], legacy_export_sha256="a" * 64,
                                   legacy_as_of="2026-08-22")
                item = result["workItems"][0]
                self.assertEqual(item["currentSourceGalleryImageCount"], images)
                self.assertEqual(item["sourceGalleryReviewGate"], expected)
                self.assertFalse(item["sourceGalleryFullyProven"])
        invalid = source()
        invalid["products"][1]["sourceGalleryImageCount"] = True
        with self.assertRaisesRegex(DriveReconciliationError, "invalid source gallery image count"):
            reconcile(invalid, [row("COBERTO_CATALOGO_SHA", "11", "b")],
                      legacy_export_sha256="a" * 64, legacy_as_of="2026-08-22")

    def test_published_metadata_mismatch_fails_closed(self):
        with self.assertRaisesRegex(DriveReconciliationError, "requires active SHA index"):
            report(rows=[row("COBERTO_CATALOGO_SHA", "11", "b")]) if False else reconcile(
                source(), [], legacy_export_sha256="b" * 64,
                legacy_as_of="2026-08-22", published_models=[])

    def fixture_bulk_report(self):
        report_data = report()
        item = report_data["workItems"][0]
        report_data.update({
            "currentCoverageSha256": "c" * 64,
            "activeImageIndexSha256": "a" * 64,
            "publishedModelsSnapshotSha256": "b" * 64,
        })
        item.update({
            "shaReviewTier": "A_exact_name_and_franchise",
            "shaCandidateModelIds": ["mdl_" + "1" * 20],
            "sourceLinkage": "id_and_slug",
            "legacySourceProductId": 11,
            "currentSourceProductId": 11,
            "currentD1IdentityState": "unreviewed_no_exact_name_candidate",
            "currentIdentityConfirmed": False,
            "identityApprovedByThisReport": False,
            "mediaPromotionAuthorized": False,
        })
        return report_data

    def test_bulk_template_never_approves_automatically(self):
        sample = self.fixture_bulk_report()
        template = build_operator_review_template(sample)
        self.assertEqual(len(template), 1)
        self.assertEqual(template[0]["sourceProductId"], "11")
        self.assertEqual(template[0]["decision"], "")
        self.assertEqual(template[0]["visualReviewed"], "")
        self.assertEqual(template[0]["fullGalleryReviewed"], "")
        approved = render_operator_approved_evidence(sample, template)
        self.assertEqual(approved, [])

    def test_bulk_review_accepts_only_explicit_three_gate_decision(self):
        sample = self.fixture_bulk_report()
        reviewed = build_operator_review_template(sample)[0]
        reviewed.update({
            "decision": "approve_map_existing", "visualReviewed": "yes",
            "provenanceReviewed": "yes", "fullGalleryReviewed": "yes",
            "reviewer": "Catalog curator", "reviewedAt": "2026-10-29",
        })
        evidence = render_operator_approved_evidence(sample, [reviewed])
        self.assertEqual(len(evidence), 1)
        self.assertEqual(evidence[0]["identityReview"]["targetModelId"], "mdl_" + "1" * 20)
        self.assertTrue(evidence[0]["identityReview"]["mapExistingApproved"])
        self.assertFalse(evidence[0]["decision"]["mediaPromotionAuthorized"])
        self.assertEqual(evidence[0]["decision"]["productionWrites"], 0)

    def test_bulk_decisions_reject_stale_or_unreviewed_attestations(self):
        sample = self.fixture_bulk_report()
        base = build_operator_review_template(sample)[0]
        for change in (
            {"sourceSnapshotSha256": "0" * 64},
            {"targetModelId": "mdl_" + "f" * 20},
            {"sourceImageSha256": "0" * 64},
            {"decision": "approve_map_existing"},
            {"decision": "approve_map_existing", "visualReviewed": "yes"},
        ):
            candidate = {**base, **change}
            with self.subTest(change=change), self.assertRaises(DriveReconciliationError):
                render_operator_approved_evidence(sample, [candidate])
        with self.assertRaises(DriveReconciliationError):
            render_operator_approved_evidence(sample, [base, base])

    def test_bulk_review_requires_content_pinned_current_snapshots(self):
        report_data = self.fixture_bulk_report()
        current = build_operator_review_template(report_data)[0]
        for changed in (
            {"currentCoverageSha256": "0" * 64},
            {"activeImageIndexSha256": "0" * 64},
            {"publishedModelsSnapshotSha256": "0" * 64},
            {"legacyCsvSha256": "0" * 64},
        ):
            stale = {**report_data, **changed}
            with self.subTest(changed=changed), self.assertRaisesRegex(
                DriveReconciliationError, "current snapshot"
            ):
                render_operator_approved_evidence(stale, [current])
        for key in ("currentCoverageSha256", "activeImageIndexSha256", "publishedModelsSnapshotSha256"):
            incomplete = dict(report_data)
            incomplete.pop(key)
            with self.subTest(missing=key), self.assertRaisesRegex(
                DriveReconciliationError, "complete versioned"
            ):
                build_operator_review_template(incomplete)

    def test_bulk_review_excludes_unresolved_ambiguous_or_conflicting(self):
        sample = self.fixture_bulk_report()
        item = sample["workItems"][0]
        for mutation in (
            {"shaReviewTier": "B_compatible_labels"},
            {"shaCandidateModelIds": ["mdl_" + "1" * 20, "mdl_" + "2" * 20]},
            {"sourceLinkage": "slug_only"},
            {"currentD1IdentityState": "reviewed_unresolved"},
            {"currentIdentityConfirmed": True},
        ):
            altered = dict(item)
            altered.update(mutation)
            copy_report = {**sample, "workItems": [altered]}
            with self.subTest(mutation=mutation):
                self.assertEqual(build_operator_review_template(copy_report), [])

    def test_no_drive_paths_or_names_leak_into_review_output(self):
        r = row("COBERTO_CATALOGO_SHA", "11", "b")
        r["imagem_privada"] = r"C:\Users\PRIVATE\picture.jpg"
        r["novos_sha_paths"] = r"G:\Meu Drive\hidden.jpg"
        z = report(rows=[r])
        self.assertNotIn("PRIVATE", str(z))
        self.assertNotIn("hidden.jpg", str(z))


if __name__ == "__main__":
    unittest.main()
