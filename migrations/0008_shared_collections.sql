CREATE TABLE IF NOT EXISTS shared_collections (
  code TEXT PRIMARY KEY,
  fingerprint TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL CHECK(length(name) BETWEEN 1 AND 48),
  item_count INTEGER NOT NULL CHECK(item_count BETWEEN 1 AND 100),
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL CHECK(expires_at > created_at)
);

CREATE TABLE IF NOT EXISTS shared_collection_items (
  collection_code TEXT NOT NULL REFERENCES shared_collections(code) ON DELETE CASCADE,
  model_id TEXT NOT NULL REFERENCES models(id) ON DELETE RESTRICT,
  position INTEGER NOT NULL CHECK(position >= 0),
  PRIMARY KEY (collection_code, model_id),
  UNIQUE (collection_code, position)
);

CREATE INDEX IF NOT EXISTS idx_shared_collections_expires
  ON shared_collections(expires_at);

CREATE INDEX IF NOT EXISTS idx_shared_collection_items_model
  ON shared_collection_items(model_id);
