from __future__ import annotations

import io
import json
import unittest
import urllib.parse
from email.message import Message
from urllib.request import Request

from verify_public_catalog import (
    CatalogSmokeError,
    public_media_url,
    verify_public_catalog,
    verify_public_catalog_exhaustive,
    verify_public_model_gallery,
    verify_public_galleries,
)


class FakeResponse:
    def __init__(self, body: bytes, status: int = 200, content_type: str = "application/json") -> None:
        self._body = io.BytesIO(body)
        self.status = status
        self.headers = Message()
        self.headers["Content-Type"] = content_type

    def read(self, size: int = -1) -> bytes:
        return self._body.read(size)

    def __enter__(self):
        return self

    def __exit__(self, exc_type, exc, tb):
        return False


class FakeOpener:
    def __init__(self, catalog_items: list[dict], image_content_type: str = "image/webp") -> None:
        self.catalog_items = catalog_items
        self.image_content_type = image_content_type
        self.requests: list[Request] = []

    def __call__(self, request: Request, timeout: int = 20):
        self.requests.append(request)
        url = request.full_url
        if url.endswith("/api/health"):
            return FakeResponse(json.dumps({"ok": True}).encode())
        if "/api/catalog?limit=1" in url:
            return FakeResponse(json.dumps({"items": self.catalog_items, "nextCursor": None}).encode())
        return FakeResponse(b"R", status=206, content_type=self.image_content_type)


class ExhaustiveOpener:
    def __init__(
        self,
        categories: list[dict],
        pages: dict[str | None, dict],
        galleries: dict[tuple[str, str | None], dict] | None = None,
    ) -> None:
        self.categories = categories
        self.pages = pages
        self.galleries = galleries or {}
        self.requests: list[Request] = []

    def __call__(self, request: Request, timeout: int = 20):
        self.requests.append(request)
        parsed = urllib.parse.urlparse(request.full_url)
        if parsed.path.endswith("/api/categories"):
            return FakeResponse(json.dumps({"items": self.categories}).encode())
        if parsed.path.endswith("/api/catalog"):
            query = urllib.parse.parse_qs(parsed.query)
            cursor = query.get("cursor", [None])[0]
            if cursor not in self.pages:
                raise AssertionError(f"cursor inesperado: {cursor!r}")
            return FakeResponse(json.dumps(self.pages[cursor]).encode())
        if "/api/models/" in parsed.path and parsed.path.endswith("/images"):
            slug = urllib.parse.unquote(parsed.path.split("/api/models/", 1)[1].rsplit("/images", 1)[0])
            query = urllib.parse.parse_qs(parsed.query)
            cursor = query.get("cursor", [None])[0]
            key = (slug, cursor)
            if key not in self.galleries:
                raise AssertionError(f"galeria inesperada: {key!r}")
            return FakeResponse(json.dumps(self.galleries[key]).encode())
        raise AssertionError(f"URL inesperada: {request.full_url}")


def audit_row(
    model_id: str,
    slug: str,
    code: str,
    category_slug: str,
    *,
    cover: str | None = None,
    image_count: int = 1,
    gallery_version: int = 1,
) -> dict:
    return {
        "id": model_id,
        "slug": slug,
        "code": code,
        "category_slug": category_slug,
        "cover_storage_key": cover or f"media/{model_id}/card.webp",
        "image_count": image_count,
        "gallery_version": gallery_version,
    }


class PublicCatalogSmokeTests(unittest.TestCase):
    def test_smoke_requires_and_verifies_real_cover(self) -> None:
        opener = FakeOpener([{
            "id": "mdl_1",
            "slug": "modelo-um",
            "cover_storage_key": "media/mdl_1/img 1/card.webp",
        }])

        result = verify_public_catalog("https://api.example.com/", "https://media.example.com/", opener=opener)

        self.assertTrue(result["ok"])
        self.assertEqual(result["modelId"], "mdl_1")
        self.assertEqual(result["mediaStatus"], 206)
        self.assertEqual(result["mediaContentType"], "image/webp")
        self.assertEqual(
            opener.requests[-1].full_url,
            "https://media.example.com/media/mdl_1/img%201/card.webp",
        )
        self.assertEqual(opener.requests[-1].get_header("Range"), "bytes=0-0")

    def test_empty_catalog_fails_even_when_health_is_ok(self) -> None:
        with self.assertRaisesRegex(CatalogSmokeError, "ainda não possui modelos"):
            verify_public_catalog("https://api.example.com", "https://media.example.com", opener=FakeOpener([]))

    def test_non_image_cover_fails(self) -> None:
        opener = FakeOpener([{
            "id": "mdl_1",
            "slug": "modelo-um",
            "cover_storage_key": "media/mdl_1/img_1/card.webp",
        }], image_content_type="text/html")
        with self.assertRaisesRegex(CatalogSmokeError, "não é imagem"):
            verify_public_catalog("https://api.example.com", "https://media.example.com", opener=opener)

    def test_storage_key_rejects_parent_segments(self) -> None:
        with self.assertRaises(CatalogSmokeError):
            public_media_url("https://media.example.com", "media/../secret")


class PublicGalleryAuditTests(unittest.TestCase):
    def model(self) -> dict:
        return audit_row(
            "mdl_1",
            "modelo-um",
            "TS-1",
            "games",
            image_count=3,
            gallery_version=77,
        )

    def galleries(self) -> dict[tuple[str, str | None], dict]:
        cursor = "Mg=="
        return {
            ("modelo-um", None): {
                "items": [
                    {"id": "img-1", "role": "cover"},
                    {"id": "img-2", "role": "gallery"},
                ],
                "total": 3,
                "version": 77,
                "nextCursor": cursor,
            },
            ("modelo-um", cursor): {
                "items": [{"id": "img-3", "role": "gallery"}],
                "total": 3,
                "version": 77,
                "nextCursor": None,
            },
        }

    def test_gallery_audit_walks_pages_and_matches_model_contract(self) -> None:
        opener = ExhaustiveOpener([], {}, self.galleries())

        result = verify_public_model_gallery(
            "https://api.example.com",
            self.model(),
            opener=opener,
            page_limit=2,
        )

        self.assertEqual(result["images"], 3)
        self.assertEqual(result["pages"], 2)
        self.assertEqual(result["version"], 77)
        self.assertIn("v=77", opener.requests[0].full_url)

    def test_gallery_audit_rejects_total_mismatch(self) -> None:
        galleries = self.galleries()
        galleries[("modelo-um", None)]["total"] = 2

        with self.assertRaisesRegex(CatalogSmokeError, "total 2 != image_count 3"):
            verify_public_model_gallery(
                "https://api.example.com",
                self.model(),
                opener=ExhaustiveOpener([], {}, galleries),
                page_limit=2,
            )

    def test_gallery_audit_rejects_version_mismatch(self) -> None:
        galleries = self.galleries()
        galleries[("modelo-um", None)]["version"] = 78

        with self.assertRaisesRegex(CatalogSmokeError, "versão 78 != gallery_version 77"):
            verify_public_model_gallery(
                "https://api.example.com",
                self.model(),
                opener=ExhaustiveOpener([], {}, galleries),
                page_limit=2,
            )

    def test_gallery_audit_rejects_duplicate_image_ids(self) -> None:
        galleries = self.galleries()
        galleries[("modelo-um", "Mg==")]["items"][0]["id"] = "img-2"

        with self.assertRaisesRegex(CatalogSmokeError, "IDs de imagem duplicados"):
            verify_public_model_gallery(
                "https://api.example.com",
                self.model(),
                opener=ExhaustiveOpener([], {}, galleries),
                page_limit=2,
            )

    def test_gallery_set_selects_multi_image_models_deterministically(self) -> None:
        one = self.model()
        two = audit_row(
            "mdl_2",
            "modelo-dois",
            "TS-2",
            "games",
            image_count=2,
            gallery_version=22,
        )
        galleries = self.galleries()
        galleries[("modelo-dois", None)] = {
            "items": [
                {"id": "img-a", "role": "cover"},
                {"id": "img-b", "role": "gallery"},
            ],
            "total": 2,
            "version": 22,
            "nextCursor": None,
        }
        opener = ExhaustiveOpener([], {}, galleries)

        result = verify_public_galleries(
            "https://api.example.com",
            [two, one],
            opener=opener,
            sample_limit=1,
        )

        self.assertEqual(result["multiImageModels"], 2)
        self.assertEqual(result["checkedModels"], 1)
        self.assertEqual(result["models"][0]["slug"], "modelo-um")
        self.assertFalse(result["allChecked"])


class PublicCatalogExhaustiveTests(unittest.TestCase):
    def categories(self) -> list[dict]:
        return [
            {"id": "all", "count": 3},
            {"id": "games", "count": 2},
            {"id": "anime", "count": 1},
        ]

    def pages(self) -> dict[str | None, dict]:
        return {
            None: {
                "items": [
                    audit_row("mdl_1", "modelo-um", "TS-1", "games"),
                    audit_row("mdl_2", "modelo-dois", "TS-2", "games"),
                ],
                "nextCursor": "cursor-2",
            },
            "cursor-2": {
                "items": [audit_row("mdl_3", "modelo-tres", "TS-3", "anime")],
                "nextCursor": None,
            },
        }

    def test_exhaustive_audit_walks_all_pages_and_validates_totals(self) -> None:
        result = verify_public_catalog_exhaustive(
            "https://api.example.com/",
            opener=ExhaustiveOpener(self.categories(), self.pages()),
        )

        self.assertTrue(result["ok"])
        self.assertTrue(result["exhaustive"])
        self.assertEqual(result["pages"], 2)
        self.assertEqual(result["totalItems"], 3)
        self.assertEqual(result["expectedTotal"], 3)
        self.assertEqual(result["uniqueIds"], 3)
        self.assertEqual(result["uniqueSlugs"], 3)
        self.assertEqual(result["uniqueCodes"], 3)
        self.assertEqual(result["missingCoverCount"], 0)
        self.assertEqual(result["zeroImageCount"], 0)
        self.assertEqual(result["categoryMismatchCount"], 0)

    def test_exhaustive_audit_rejects_duplicate_slug(self) -> None:
        pages = self.pages()
        pages["cursor-2"]["items"][0]["slug"] = "modelo-um"
        with self.assertRaisesRegex(CatalogSmokeError, "slugs duplicados"):
            verify_public_catalog_exhaustive(
                "https://api.example.com",
                opener=ExhaustiveOpener(self.categories(), pages),
            )

    def test_exhaustive_audit_rejects_category_count_mismatch(self) -> None:
        categories = self.categories()
        categories[1]["count"] = 3
        with self.assertRaisesRegex(CatalogSmokeError, "contagens de categoria divergentes"):
            verify_public_catalog_exhaustive(
                "https://api.example.com",
                opener=ExhaustiveOpener(categories, self.pages()),
            )

    def test_exhaustive_can_audit_all_multi_image_galleries(self) -> None:
        pages = self.pages()
        pages[None]["items"][0] = audit_row(
            "mdl_1", "modelo-um", "TS-1", "games", image_count=2, gallery_version=9
        )
        galleries = {
            ("modelo-um", None): {
                "items": [
                    {"id": "img-1", "role": "cover"},
                    {"id": "img-2", "role": "gallery"},
                ],
                "total": 2,
                "version": 9,
                "nextCursor": None,
            }
        }

        result = verify_public_catalog_exhaustive(
            "https://api.example.com",
            opener=ExhaustiveOpener(self.categories(), pages, galleries),
            verify_all_galleries=True,
        )

        self.assertEqual(result["galleryAudit"]["multiImageModels"], 1)
        self.assertEqual(result["galleryAudit"]["checkedModels"], 1)
        self.assertTrue(result["galleryAudit"]["allChecked"])

    def test_exhaustive_audit_rejects_cursor_cycle(self) -> None:
        pages = self.pages()
        pages["cursor-2"]["nextCursor"] = "cursor-2"
        with self.assertRaisesRegex(CatalogSmokeError, "entrou em ciclo"):
            verify_public_catalog_exhaustive(
                "https://api.example.com",
                opener=ExhaustiveOpener(self.categories(), pages),
            )


if __name__ == "__main__":
    unittest.main()
