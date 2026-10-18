PRAGMA foreign_keys = ON;

-- R25b: append-only seller audit ledger. The pre-existing quote_requests.status
-- remains the immutable initial status for backward compatibility. The current
-- status is the newest quote_status_events.to_status, falling back to that initial
-- status. No public/admin API route is enabled by this migration.
CREATE TABLE quote_status_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  quote_request_id TEXT NOT NULL REFERENCES quote_requests(id) ON DELETE RESTRICT,
  from_status TEXT NOT NULL CHECK (from_status IN ('new','in_review','response_recorded','closed')),
  to_status TEXT NOT NULL CHECK (to_status IN ('new','in_review','response_recorded','closed')),
  actor_subject TEXT NOT NULL CHECK (length(trim(actor_subject)) BETWEEN 1 AND 512),
  actor_email TEXT NOT NULL CHECK (
    length(actor_email) BETWEEN 3 AND 254
    AND actor_email = lower(trim(actor_email))
    AND instr(actor_email,'@') > 1
  ),
  actor_role TEXT NOT NULL CHECK (actor_role IN ('operator','owner')),
  response_text TEXT CHECK (response_text IS NULL OR length(trim(response_text)) BETWEEN 1 AND 4000),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_quote_status_events_quote_revision
  ON quote_status_events(quote_request_id, id DESC);

-- The allowed transitions mirror worker/quoteWorkflow.ts. An integration test
-- compares every status pair against that canonical workflow to prevent drift.
CREATE TRIGGER trg_quote_status_events_validate
BEFORE INSERT ON quote_status_events
BEGIN
  SELECT CASE WHEN NEW.from_status IS NOT COALESCE(
    (SELECT event.to_status FROM quote_status_events event
      WHERE event.quote_request_id = NEW.quote_request_id
      ORDER BY event.id DESC LIMIT 1),
    (SELECT request.status FROM quote_requests request
      WHERE request.id = NEW.quote_request_id)
  ) THEN RAISE(ABORT, 'quote_status_stale') END;
  SELECT CASE WHEN NOT (
    (NEW.from_status = 'new' AND NEW.to_status = 'in_review') OR
    (NEW.from_status = 'in_review' AND NEW.to_status = 'response_recorded') OR
    (NEW.from_status = 'in_review' AND NEW.to_status = 'closed') OR
    (NEW.from_status = 'response_recorded' AND NEW.to_status = 'closed')
  ) THEN RAISE(ABORT, 'quote_transition_forbidden') END;
  SELECT CASE WHEN
    (NEW.to_status = 'response_recorded' AND NEW.response_text IS NULL) OR
    (NEW.to_status <> 'response_recorded' AND NEW.response_text IS NOT NULL)
  THEN RAISE(ABORT, 'quote_response_inconsistent') END;
END;

CREATE TRIGGER trg_quote_status_events_immutable_update
BEFORE UPDATE ON quote_status_events
BEGIN
  SELECT RAISE(ABORT, 'quote_event_immutable');
END;

CREATE TRIGGER trg_quote_status_events_immutable_delete
BEFORE DELETE ON quote_status_events
BEGIN
  SELECT RAISE(ABORT, 'quote_event_immutable');
END;

-- The original status is a baseline, never an independently editable state.
-- Only the append-only ledger records administrative state changes.
CREATE TRIGGER trg_quote_requests_initial_status_insert
BEFORE INSERT ON quote_requests
WHEN NEW.status <> 'new'
BEGIN
  SELECT RAISE(ABORT, 'quote_initial_status_invalid');
END;

CREATE TRIGGER trg_quote_requests_initial_status_immutable
BEFORE UPDATE OF status ON quote_requests
WHEN NEW.status IS NOT OLD.status
BEGIN
  SELECT RAISE(ABORT, 'quote_initial_status_immutable');
END;
