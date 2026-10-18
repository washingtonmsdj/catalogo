from __future__ import annotations

import re
import sqlite3
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
MIGRATIONS = ROOT / "migrations"
WORKFLOW = ROOT / "worker" / "quoteWorkflow.ts"
STATES = ("new", "in_review", "response_recorded", "closed")


def canonical_transitions() -> set[tuple[str, str]]:
    source = WORKFLOW.read_text(encoding="utf-8")
    match = re.search(r"export const QUOTE_TRANSITIONS:[^=]+=[ ]*\{([\s\S]*?)\n\}", source)
    if not match:
        raise AssertionError("canonical TS transitions missing")
    rows = re.findall(r"^\s*(new|in_review|response_recorded|closed):\s*\[([^\]]*)\]", match.group(1), re.M)
    if len(rows) != len(STATES):
        raise AssertionError("canonical TS transitions incomplete")
    return {(state, target) for state, targets in rows
            for target in re.findall(r"'([^']+)'", targets)}


class QuoteAuditSchemaTests(unittest.TestCase):
    def setUp(self) -> None:
        self.db = sqlite3.connect(":memory:")
        self.db.execute("PRAGMA foreign_keys = ON")
        self.db.executescript((MIGRATIONS / "0001_catalog.sql").read_text(encoding="utf-8"))
        self.db.executescript((MIGRATIONS / "0007_quote_public_reference.sql").read_text(encoding="utf-8"))
        self.db.execute(
            "INSERT INTO quote_requests(id,reference,name,email) VALUES(?,?,?,?)",
            ("q-old", "TCS-OLD", "Cliente legado", "cliente@example.com"),
        )
        self.db.executescript((MIGRATIONS / "0021_quote_admin_audit_events.sql").read_text(encoding="utf-8"))

    def tearDown(self) -> None:
        self.db.close()

    def event(self, quote_id: str, old: str, new: str,
              response_text: str | None = None, role: str = "operator") -> None:
        self.db.execute(
            """INSERT INTO quote_status_events(
                quote_request_id,from_status,to_status,actor_subject,actor_email,
                actor_role,response_text
            ) VALUES (?,?,?,?,?,?,?)""",
            (quote_id, old, new, "access-subject", "operator@example.com", role, response_text),
        )

    def status(self, quote_id: str) -> str:
        return self.db.execute(
            """SELECT COALESCE(
                 (SELECT to_status FROM quote_status_events
                  WHERE quote_request_id=q.id ORDER BY id DESC LIMIT 1),
                 q.status
               ) FROM quote_requests q WHERE q.id=?""", (quote_id,)
        ).fetchone()[0]

    def test_full_legal_journey_is_audited_and_initial_status_is_stable(self) -> None:
        self.assertEqual(self.status("q-old"), "new")
        self.event("q-old", "new", "in_review")
        self.event("q-old", "in_review", "response_recorded", "Orçamento revisado internamente")
        self.event("q-old", "response_recorded", "closed")
        self.assertEqual(self.status("q-old"), "closed")
        rows = self.db.execute(
            "SELECT from_status,to_status,actor_subject,response_text FROM quote_status_events ORDER BY id"
        ).fetchall()
        self.assertEqual(len(rows), 3)
        self.assertEqual(rows[1][-1], "Orçamento revisado internamente")
        self.assertTrue(all(row[2] == "access-subject" for row in rows))
        self.assertEqual(self.db.execute(
            "SELECT status FROM quote_requests WHERE id='q-old'"
        ).fetchone()[0], "new")
        with self.assertRaises(sqlite3.IntegrityError):
            self.event("q-old", "closed", "in_review")

    def test_stale_or_concurrent_transition_cannot_overwrite_audit_state(self) -> None:
        self.event("q-old", "new", "in_review")
        with self.assertRaisesRegex(sqlite3.IntegrityError, "quote_status_stale"):
            self.event("q-old", "new", "in_review")
        self.assertEqual(self.db.execute("SELECT COUNT(*) FROM quote_status_events").fetchone()[0], 1)

    def test_sql_transition_guard_matches_all_canonical_typescript_pairs(self) -> None:
        allowed = canonical_transitions()
        self.assertEqual(allowed, {
            ("new", "in_review"),
            ("in_review", "response_recorded"),
            ("in_review", "closed"),
            ("response_recorded", "closed"),
        })
        # Seed legacy starting statuses before this migration to test every edge.
        for old in STATES:
            for new in STATES:
                with self.subTest(old=old, new=new):
                    quote_id = f"q-{old}-{new}"
                    db = sqlite3.connect(":memory:")
                    db.execute("PRAGMA foreign_keys = ON")
                    db.executescript((MIGRATIONS / "0001_catalog.sql").read_text(encoding="utf-8"))
                    db.execute("INSERT INTO quote_requests(id,name,email,status) VALUES(?,?,?,?)",
                               (quote_id, "Legado", "x@example.com", old))
                    db.executescript((MIGRATIONS / "0021_quote_admin_audit_events.sql").read_text(encoding="utf-8"))
                    operation = lambda: db.execute(
                        """INSERT INTO quote_status_events
                           (quote_request_id,from_status,to_status,actor_subject,actor_email,actor_role,response_text)
                           VALUES(?,?,?,?,?,?,?)""",
                        (quote_id, old, new, "subject", "op@example.com", "owner",
                         "Resposta interna" if new == "response_recorded" else None))
                    if (old, new) in allowed:
                        operation()
                    else:
                        with self.assertRaises(sqlite3.IntegrityError):
                            operation()
                    db.close()

    def test_append_only_events_and_initial_status_are_immutable(self) -> None:
        self.event("q-old", "new", "in_review")
        with self.assertRaises(sqlite3.IntegrityError):
            self.db.execute("UPDATE quote_status_events SET actor_role='owner'")
        with self.assertRaises(sqlite3.IntegrityError):
            self.db.execute("DELETE FROM quote_status_events")
        with self.assertRaises(sqlite3.IntegrityError):
            self.db.execute("UPDATE quote_requests SET status='closed' WHERE id='q-old'")
        with self.assertRaises(sqlite3.IntegrityError):
            self.db.execute("DELETE FROM quote_requests WHERE id='q-old'")
        with self.assertRaises(sqlite3.IntegrityError):
            self.db.execute(
                "INSERT INTO quote_requests(id,name,email,status) VALUES('invalid','x','x@x.com','closed')"
            )

    def test_response_requires_durable_content_and_only_operator_or_owner(self) -> None:
        self.event("q-old", "new", "in_review")
        with self.assertRaises(sqlite3.IntegrityError):
            self.event("q-old", "in_review", "response_recorded")
        with self.assertRaises(sqlite3.IntegrityError):
            self.event("q-old", "in_review", "closed", "Nonresponse content")
        with self.assertRaises(sqlite3.IntegrityError):
            self.event("q-old", "in_review", "closed", role="viewer")
        with self.assertRaises(sqlite3.IntegrityError):
            self.db.execute(
                """INSERT INTO quote_status_events
                  (quote_request_id,from_status,to_status,actor_subject,actor_email,actor_role)
                  VALUES('q-old','in_review','closed','','op@example.com','owner')"""
            )
        self.assertEqual(self.status("q-old"), "in_review")


if __name__ == "__main__":
    unittest.main()
