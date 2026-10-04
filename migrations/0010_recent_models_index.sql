CREATE INDEX IF NOT EXISTS idx_models_published_created
ON models(published, created_at DESC, id DESC);
