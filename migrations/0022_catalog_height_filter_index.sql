-- Supports published catalog range filters while leaving keyset order unchanged.
CREATE INDEX IF NOT EXISTS idx_models_published_height
ON models(published, height_cm);
