import sqlite3
import unittest


DEDUP_MINUTES = 10


class QuoteDedupTests(unittest.TestCase):
    def setUp(self):
        self.db = sqlite3.connect(":memory:")
        self.db.executescript(
            """
            CREATE TABLE quote_requests (
              id TEXT PRIMARY KEY,
              reference TEXT,
              name TEXT NOT NULL,
              email TEXT NOT NULL,
              notes TEXT,
              created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
            );
            CREATE TABLE quote_request_items (
              quote_request_id TEXT NOT NULL,
              model_id TEXT NOT NULL,
              quantity INTEGER NOT NULL DEFAULT 1,
              PRIMARY KEY (quote_request_id, model_id)
            );
            """
        )

    def tearDown(self):
        self.db.close()

    def insert_quote(self, quote_id, reference, name, email, notes, model_ids, age_minutes=0):
        self.db.execute(
            """INSERT INTO quote_requests(id,reference,name,email,notes,created_at)
               VALUES(?,?,?,?,?,datetime('now', ?))""",
            (quote_id, reference, name, email, notes, f"-{age_minutes} minutes"),
        )
        self.db.executemany(
            "INSERT INTO quote_request_items(quote_request_id,model_id,quantity) VALUES(?,?,1)",
            [(quote_id, model_id) for model_id in model_ids],
        )
        self.db.commit()

    def find_duplicate(self, name, email, notes, model_ids):
        placeholders = ",".join("?" for _ in model_ids)
        sql = f"""
            SELECT qr.id,qr.reference
            FROM quote_requests qr
            WHERE qr.name=? AND qr.email=? AND COALESCE(qr.notes,'')=?
              AND qr.created_at >= datetime('now', '-{DEDUP_MINUTES} minutes')
              AND (SELECT COUNT(*) FROM quote_request_items qi WHERE qi.quote_request_id=qr.id)=?
              AND (SELECT COUNT(*) FROM quote_request_items qi
                   WHERE qi.quote_request_id=qr.id AND qi.model_id IN ({placeholders}))=?
            ORDER BY qr.created_at DESC
            LIMIT 1
        """
        params = [name, email, notes, len(model_ids), *model_ids, len(model_ids)]
        return self.db.execute(sql, params).fetchone()

    def test_same_payload_is_deduplicated_even_if_model_order_changes(self):
        self.insert_quote(
            "q-1", "TCS-AAAA", "Cliente", "cliente@example.com", "Acabamento fosco", ["m-1", "m-2"]
        )
        self.assertEqual(
            self.find_duplicate(
                "Cliente", "cliente@example.com", "Acabamento fosco", ["m-2", "m-1"]
            ),
            ("q-1", "TCS-AAAA"),
        )

    def test_different_model_set_is_a_new_request(self):
        self.insert_quote(
            "q-1", "TCS-AAAA", "Cliente", "cliente@example.com", "Acabamento fosco", ["m-1", "m-2"]
        )
        self.assertIsNone(
            self.find_duplicate(
                "Cliente", "cliente@example.com", "Acabamento fosco", ["m-1", "m-3"]
            )
        )

    def test_different_notes_are_a_new_request(self):
        self.insert_quote(
            "q-1", "TCS-AAAA", "Cliente", "cliente@example.com", "Acabamento fosco", ["m-1", "m-2"]
        )
        self.assertIsNone(
            self.find_duplicate(
                "Cliente", "cliente@example.com", "Outra medida", ["m-1", "m-2"]
            )
        )

    def test_old_request_falls_outside_dedup_window(self):
        self.insert_quote(
            "q-1", "TCS-AAAA", "Cliente", "cliente@example.com", "Acabamento fosco", ["m-1", "m-2"], age_minutes=11
        )
        self.assertIsNone(
            self.find_duplicate(
                "Cliente", "cliente@example.com", "Acabamento fosco", ["m-1", "m-2"]
            )
        )


if __name__ == "__main__":
    unittest.main()
