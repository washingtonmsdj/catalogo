PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS categories (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  slug TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  sort_order INTEGER NOT NULL DEFAULT 0,
  model_count INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS franchises (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  category_id INTEGER NOT NULL REFERENCES categories(id) ON DELETE CASCADE,
  slug TEXT NOT NULL,
  name TEXT NOT NULL,
  model_count INTEGER NOT NULL DEFAULT 0,
  UNIQUE(category_id, slug)
);

CREATE TABLE IF NOT EXISTS models (
  id TEXT PRIMARY KEY,
  franchise_id INTEGER NOT NULL REFERENCES franchises(id) ON DELETE RESTRICT,
  slug TEXT NOT NULL UNIQUE,
  code TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  collection TEXT,
  material TEXT,
  height_cm REAL,
  description TEXT,
  image_count INTEGER NOT NULL DEFAULT 0,
  cover_image_id TEXT,
  published INTEGER NOT NULL DEFAULT 0,
  search_text TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS images (
  id TEXT PRIMARY KEY,
  model_id TEXT NOT NULL REFERENCES models(id) ON DELETE CASCADE,
  sha256 TEXT NOT NULL,
  phash TEXT,
  width INTEGER NOT NULL,
  height INTEGER NOT NULL,
  bytes INTEGER NOT NULL,
  mime TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'gallery',
  quality_score REAL NOT NULL DEFAULT 0,
  duplicate_group TEXT,
  storage_key TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_images_model_sha ON images(model_id, sha256);
CREATE INDEX IF NOT EXISTS idx_models_franchise_published ON models(franchise_id, published, name);
CREATE INDEX IF NOT EXISTS idx_models_search ON models(published, search_text);
CREATE INDEX IF NOT EXISTS idx_images_model_quality ON images(model_id, quality_score DESC, id);

CREATE TABLE IF NOT EXISTS quote_requests (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  email TEXT NOT NULL,
  notes TEXT,
  status TEXT NOT NULL DEFAULT 'new',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS quote_request_items (
  quote_request_id TEXT NOT NULL REFERENCES quote_requests(id) ON DELETE CASCADE,
  model_id TEXT NOT NULL REFERENCES models(id) ON DELETE RESTRICT,
  quantity INTEGER NOT NULL DEFAULT 1,
  PRIMARY KEY (quote_request_id, model_id)
);

CREATE INDEX IF NOT EXISTS idx_quotes_created ON quote_requests(created_at DESC);
