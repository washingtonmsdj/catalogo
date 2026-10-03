from __future__ import annotations

import io
import json
import unittest
from email.message import Message
from urllib.request import Request

from verify_public_catalog import CatalogSmokeError, public_media_url, verify_public_catalog


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


if __name__ == "__main__":
    unittest.main()
