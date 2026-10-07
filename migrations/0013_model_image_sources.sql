PRAGMA foreign_keys = ON;

-- Índice consultável de identidade das imagens publicadas.
-- R2/manifests continuam sendo a fonte canônica da galeria; esta tabela
-- materializa apenas metadados necessários para auditoria em escala.
CREATE TABLE IF NOT EXISTS model_image_sources (
  model_id TEXT NOT NULL REFERENCES models(id) ON DELETE CASCADE,
  image_id TEXT NOT NULL,
  position INTEGER NOT NULL CHECK(position >= 0),
  role TEXT NOT NULL CHECK(role IN ('cover','gallery')),
  source_sha256 TEXT NOT NULL
    CHECK(length(source_sha256) = 64 AND source_sha256 = lower(source_sha256)
      AND source_sha256 NOT GLOB '*[^0-9a-f]*'),
  gallery_version INTEGER NOT NULL CHECK(gallery_version >= 1),
  PRIMARY KEY (model_id, image_id),
  UNIQUE (model_id, position, gallery_version),
  UNIQUE (model_id, source_sha256, gallery_version)
);

CREATE INDEX IF NOT EXISTS idx_model_image_sources_sha
  ON model_image_sources(source_sha256, model_id, gallery_version);

CREATE INDEX IF NOT EXISTS idx_model_image_sources_model_version
  ON model_image_sources(model_id, gallery_version, position);
