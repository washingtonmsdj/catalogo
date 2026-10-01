from __future__ import annotations

import json
import sqlite3
import tempfile
import unittest
from pathlib import Path

from publish_d1 import build_statements, load_models, publish, validate_manifest


def record(
    model_id: str = "mdl-a",
    slug: str = "heroi-a",
    code: str = "TS-AAAA",
    display_name: str = "Heroi A",
) -> dict:
    return {
        "id": model_id,
        "slug": slug,
        "code": code,
        "sourceHierarchy": ["Games", "Saga", display_name],
        "categoryName": "Games",
        "categorySlug": "games",
        "franchiseName": "Saga",
        "franchiseSlug": "saga",
        "displayName": display_name,
        "collection": "",
        "searchText": f"{display_name} Saga Games",
        "imageCount": 2,
        "coverStorageKey": f"media/{model_id}/cover/card.webp",
        "galleryManifestKey": f"gallery/{model_id}/manifest.json",
        "galleryVersion": 123,
    }


class FakeClient:
    def __init__(self) -> None:
        self.batches: list[list[dict]] = []

    def execute_batch(self, statements: list[dict]) -> None:
        self.batches.append(statements)


class CatalogD1PublisherTests(unittest.TestCase):
    def test_statements_deduplicate_taxonomy(self) -> None:
        rows = validate_manifest([
            record(),
            record("mdl-b", "heroi-b", "TS-BBBB", "Heroi B"),
        ])

        statements = build_statements(rows)

        self.assertEqual(len(statements), 4)
        self.assertIn("INSERT INTO categories", statements[0]["sql"])
        self.assertIn("INSERT INTO franchises", statements[1]["sql"])
        model_sql = statements[2]["sql"]
        self.assertIn("ON CONFLICT(id) DO UPDATE", model_sql)
        self.assertNotIn("material", model_sql)
        self.assertNotIn("description", model_sql)
        self.assertNotIn("height_cm", model_sql)

    def test_manifest_rejects_slug_collision_between_models(self) -> None:
        first = record()
        second = record("mdl-b", "heroi-a", "TS-BBBB", "Heroi B")

        with self.assertRaisesRegex(ValueError, "colisão de slug"):
            validate_manifest([first, second])

    def test_manifest_rejects_taxonomy_mismatch(self) -> None:
        row = record()
        row["sourceHierarchy"][0] = "Animes"

        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "models.jsonl"
            path.write_text(json.dumps(row) + "\n", encoding="utf-8")
            with self.assertRaisesRegex(ValueError, "taxonomia diverge"):
                load_models(path)

    def test_publish_batches_are_bounded_and_retry_safe(self) -> None:
        rows = validate_manifest([
            record(),
            record("mdl-b", "heroi-b", "TS-BBBB", "Heroi B"),
        ])
        client = FakeClient()

        summary = publish(rows, client, batch_size=2)
        self.assertEqual(summary["models"], 2)
        self.assertEqual(summary["statements"], 4)
        self.assertEqual(summary["batches"], 2)
        self.assertEqual([len(batch) for batch in client.batches], [2, 2])

        second_client = FakeClient()
        second_summary = publish(rows, second_client, batch_size=2)
        self.assertEqual(second_summary, summary)
        self.assertEqual(second_client.batches, client.batches)

    def test_dry_run_never_calls_remote_client(self) -> None:
        rows = validate_manifest([record()])
        client = FakeClient()

        summary = publish(rows, client, dry_run=True)

        self.assertTrue(summary["dryRun"])
        self.assertEqual(client.batches, [])

    def test_generated_statements_apply_idempotently_to_catalog_schema(self) -> None:
        connection = sqlite3.connect(":memory:")
        migrations = Path(__file__).resolve().parent.parent / "migrations"
        for migration in sorted(migrations.glob("*.sql")):
            connection.executescript(migration.read_text(encoding="utf-8"))

        rows = validate_manifest([
            record(),
            record("mdl-b", "heroi-b", "TS-BBBB", "Heroi B"),
        ])
        statements = build_statements(rows)
        for statement in statements:
            connection.execute(statement["sql"], statement["params"])
        connection.execute("UPDATE models SET material='Resina' WHERE id='mdl-a'")
        connection.commit()

        for statement in statements:
            connection.execute(statement["sql"], statement["params"])
        connection.commit()

        self.assertEqual(connection.execute("SELECT COUNT(*) FROM models").fetchone()[0], 2)
        self.assertEqual(connection.execute("SELECT model_count FROM categories WHERE slug='games'").fetchone()[0], 2)
        self.assertEqual(connection.execute("SELECT material FROM models WHERE id='mdl-a'").fetchone()[0], "Resina")
        self.assertEqual(connection.execute("SELECT COUNT(*) FROM models_fts").fetchone()[0], 2)
        connection.close()


if __name__ == "__main__":
    unittest.main()
