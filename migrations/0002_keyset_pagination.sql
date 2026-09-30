CREATE INDEX IF NOT EXISTS idx_models_published_name_id
ON models(published, name COLLATE NOCASE, id);

CREATE INDEX IF NOT EXISTS idx_models_franchise_published_name_id
ON models(franchise_id, published, name COLLATE NOCASE, id);
