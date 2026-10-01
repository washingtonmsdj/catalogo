PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS catalog_folders (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  franchise_id INTEGER NOT NULL REFERENCES franchises(id) ON DELETE CASCADE,
  parent_id INTEGER REFERENCES catalog_folders(id) ON DELETE CASCADE,
  slug TEXT NOT NULL,
  name TEXT NOT NULL,
  path TEXT NOT NULL,
  depth INTEGER NOT NULL CHECK(depth >= 1),
  sort_order INTEGER NOT NULL DEFAULT 0,
  UNIQUE(franchise_id, path)
);

CREATE INDEX IF NOT EXISTS idx_catalog_folders_parent
  ON catalog_folders(franchise_id, parent_id, sort_order, name COLLATE NOCASE, id);

ALTER TABLE models
  ADD COLUMN folder_id INTEGER REFERENCES catalog_folders(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_models_folder_published
  ON models(folder_id, published, name COLLATE NOCASE, id);
