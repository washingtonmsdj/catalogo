from __future__ import annotations

import json
import tempfile
import unittest
from pathlib import Path

from publish_d1 import build_plan, load_models, model_query, publish


def model(**overrides):
    base = {
        "id": "mdl_1",
        "slug": "saga-heroi",
        "code": "TS-ABC",
        "categoryName": "Games",
        "categorySlug": "games",
        "franchiseName": "Saga",
        "franchiseSlug": "saga",
        "displayName": "Heroi",
        "collection": "",
        "searchText": "games saga heroi ts-abc",
        "imageCount": 2,
        "coverStorageKey": "media/mdl_1/img/card.webp",
        "galleryManifestKey": "gallery/mdl_1/a.json",
        "galleryVersion": 42,
    }
    base.update(overrides)
    return base


class FakeClient:
    def __init__(self):
        self.batches = []

    def batch(self, queries):
        self.batches.append(queries)


class D1PublisherTests(unittest.TestCase):
    def test_plan_deduplicates_taxonomy_and_keeps_models(self):
        plan = build_plan([
            model(),
            model(id="mdl_2", slug="saga-vilao", code="TS-DEF", displayName="Vilao"),
        ])
        self.assertEqual(plan.categories, [{"slug": "games", "name": "Games"}])
        self.assertEqual(plan.franchises, [{"categorySlug": "games", "slug": "saga", "name": "Saga"}])
        self.assertEqual(len(plan.models), 2)

    def test_load_models_rejects_duplicate_public_slug(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "models.jsonl"
            path.write_text(
                json.dumps(model()) + "\n"
                + json.dumps(model(id="mdl_2", code="TS-DEF")) + "\n",
                encoding="utf-8",
            )
            with self.assertRaisesRegex(RuntimeError, "slug duplicado"):
                load_models(path)

    def test_model_upsert_is_non_destructive_and_publishes(self):
        query = model_query(model())
        self.assertIn("ON CONFLICT(id) DO UPDATE", query.sql)
        self.assertIn("published=1", query.sql)
        self.assertNotIn("DELETE", query.sql.upper())
        self.assertNotIn("DROP", query.sql.upper())

    def test_publish_orders_taxonomy_before_models_and_batches(self):
        plan = build_plan([
            model(),
            model(
                id="mdl_2", slug="outra-vilao", code="TS-DEF",
                franchiseName="Outra", franchiseSlug="outra", displayName="Vilao",
            ),
        ])
        client = FakeClient()
        summary = publish(plan, client, batch_size=1)
        self.assertEqual(summary["categories"], 1)
        self.assertEqual(summary["franchises"], 2)
        self.assertEqual(summary["models"], 2)
        self.assertEqual(summary["batches"], 5)
        self.assertIn("INSERT INTO categories", client.batches[0][0].sql)
        self.assertIn("INSERT INTO franchises", client.batches[1][0].sql)
        self.assertIn("INSERT INTO models", client.batches[3][0].sql)


if __name__ == "__main__":
    unittest.main()
