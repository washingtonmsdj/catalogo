PRAGMA foreign_keys = ON;

-- A relação canônico -> fonte é também a autoridade de publicação:
-- ao anexar uma ficha-vista à galeria canônica, a ficha-fonte deixa de ser
-- navegável no mesmo statement. Não há DELETE e a mídia histórica é preservada.
-- O guard usa SELECT RAISE(...) WHERE ... para evitar END; interno de CASE
-- dentro do body do trigger no runner de migrations D1.
CREATE TRIGGER IF NOT EXISTS trg_gallery_members_require_publishable_models
BEFORE INSERT ON model_gallery_members
BEGIN
  SELECT RAISE(ABORT, 'gallery members require publishable canonical and source manifests')
  WHERE NOT EXISTS (
    SELECT 1
    FROM models canonical
    JOIN models source ON source.id = NEW.source_model_id
    WHERE canonical.id = NEW.canonical_model_id
      AND canonical.published = 1
      AND canonical.image_count > 0
      AND canonical.gallery_version >= 1
      AND canonical.gallery_manifest_key IS NOT NULL
      AND canonical.gallery_manifest_key <> ''
      AND canonical.cover_storage_key IS NOT NULL
      AND canonical.cover_storage_key <> ''
      AND source.image_count > 0
      AND source.gallery_version >= 1
      AND source.gallery_manifest_key IS NOT NULL
      AND source.gallery_manifest_key <> ''
      AND source.cover_storage_key IS NOT NULL
      AND source.cover_storage_key <> ''
  );
END;

CREATE TRIGGER IF NOT EXISTS trg_gallery_members_retire_source
AFTER INSERT ON model_gallery_members
BEGIN
  UPDATE models
  SET published = 0,
      updated_at = CURRENT_TIMESTAMP
  WHERE id = NEW.source_model_id
    AND published = 1;
END;

-- Relações de identidade são imutáveis. Reorganizar uma galeria exige
-- remoção explícita + nova relação auditada; posição pode ser reordenada.
CREATE TRIGGER IF NOT EXISTS trg_gallery_members_identity_immutable
BEFORE UPDATE OF canonical_model_id, source_model_id ON model_gallery_members
BEGIN
  SELECT RAISE(ABORT, 'gallery member identity is immutable');
END;

-- Uma ficha-fonte já anexada não pode reaparecer acidentalmente no catálogo.
CREATE TRIGGER IF NOT EXISTS trg_gallery_source_cannot_republish
BEFORE UPDATE OF published ON models
WHEN NEW.published = 1
  AND OLD.published <> 1
  AND EXISTS (
    SELECT 1
    FROM model_gallery_members
    WHERE source_model_id = NEW.id
  )
BEGIN
  SELECT RAISE(ABORT, 'gallery source cannot be republished while attached');
END;
