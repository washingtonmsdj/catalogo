PRAGMA foreign_keys = ON;

ALTER TABLE models ADD COLUMN source_key TEXT;
ALTER TABLE models ADD COLUMN source_sync_id TEXT;

CREATE INDEX IF NOT EXISTS idx_models_source_key ON models(source_key);
CREATE INDEX IF NOT EXISTS idx_models_source_sync ON models(source_sync_id, published);

CREATE TABLE IF NOT EXISTS catalog_sync_runs (
  id TEXT PRIMARY KEY,
  source_sha256 TEXT NOT NULL,
  model_count INTEGER NOT NULL,
  completed_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_catalog_sync_completed ON catalog_sync_runs(completed_at DESC);
