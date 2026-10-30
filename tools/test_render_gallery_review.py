import unittest
from render_gallery_review import render


class GalleryReviewHtmlTests(unittest.TestCase):
    def fixture(self):
        return {
            "scope": "small_gallery_review_only_current_coverage_snapshot",
            "identityApproved": False, "mediaPromotionAuthorized": False,
            "summary": {"products": 1, "sourceImages": 1, "imageBytesDownloaded": 0,
                        "productionWrites": 0, "stagingWrites": 0,
                        "mandatoryMissingPublicImagesProven": False,
                        "distinctSculptureVersionsMissingProven": False},
            "items": [{"sourceProductId": 10, "sourceName": "<script>alert(1)</script>",
                       "publishedModelName": "Model", "publishedFranchiseName": "Test",
                       "targetModelId": "mdl_" + "a"*20,
                       "sourceImageCount": 1, "publishedImageCount": 1,
                       "identityApproved": False, "creatorRightsVerified": False,
                       "driveRepresentativePolicy": "one_per_distinct_sculpture_version",
                       "webAdditionalViews": "separate_explicit_quality_rights_and_identity_review",
                       "distinctSculptureVariantsProven": False,
                       "sourceViewsRequiredInPublicGallery": False,
                       "mediaPromotionAuthorized": False,
                       "images": [{"position": 1, "sourceUrl": "https://example.test/cover.webp"}]}],
        }

    def test_html_is_escaped_and_remains_review_only(self):
        html = render(self.fixture())
        self.assertIn("&lt;script&gt;", html)
        self.assertNotIn("<script>alert(1)</script>", html)
        self.assertIn("https://example.test/cover.webp", html)
        self.assertIn("nenhum vínculo ou direito aprovado", html)
        self.assertIn("não indicam modelos ou imagens faltando", html)
        self.assertIn("Não representam déficit obrigatório", html)

    def test_damaged_or_preapproved_review_is_rejected(self):
        for field, value in (("creatorRightsVerified", True),
                             ("identityApproved", True),
                             ("sourceImageCount", 2),
                             ("sourceViewsRequiredInPublicGallery", True),
                             ("distinctSculptureVariantsProven", True)):
            d = self.fixture()
            d["items"][0][field] = value
            with self.subTest(field=field), self.assertRaises(ValueError):
                render(d)
        d = self.fixture()
        d["summary"]["sourceImages"] = 2
        with self.assertRaises(ValueError):
            render(d)


if __name__ == "__main__":
    unittest.main()
