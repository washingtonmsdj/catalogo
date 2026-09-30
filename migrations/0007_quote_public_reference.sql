PRAGMA foreign_keys = ON;

ALTER TABLE quote_requests ADD COLUMN reference TEXT;

-- Registros anteriores recebem uma referência estável sem alterar o UUID interno.
UPDATE quote_requests
SET reference = 'LEGACY-' || id
WHERE reference IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_quote_requests_reference
  ON quote_requests(reference);
