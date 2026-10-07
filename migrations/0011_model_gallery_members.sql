PRAGMA foreign_keys = ON;

-- Uma ficha pública pode reutilizar galerias já publicadas de antigas fichas
-- que representavam apenas vistas do mesmo produto. Os registros-fonte são
-- preservados para manter mídia e histórico; somente a ficha canônica aparece
-- na navegação pública.
CREATE TABLE IF NOT EXISTS model_gallery_members (
  canonical_model_id TEXT NOT NULL REFERENCES models(id) ON DELETE CASCADE,
  source_model_id TEXT NOT NULL REFERENCES models(id) ON DELETE RESTRICT,
  position INTEGER NOT NULL CHECK(position >= 1),
  PRIMARY KEY (canonical_model_id, source_model_id),
  UNIQUE (source_model_id),
  UNIQUE (canonical_model_id, position),
  CHECK (canonical_model_id <> source_model_id)
);

CREATE INDEX IF NOT EXISTS idx_model_gallery_members_canonical
  ON model_gallery_members(canonical_model_id, position);
