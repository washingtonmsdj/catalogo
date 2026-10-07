PRAGMA foreign_keys = ON;

-- Identidade histórica de aliases consolidados é permanente.
-- Correções de uma relação já revisada exigem migration específica e auditada.
CREATE TRIGGER IF NOT EXISTS trg_gallery_member_public_identity_immutable
BEFORE UPDATE OF slug,code,collection ON models
WHEN (
    OLD.slug != NEW.slug
    OR OLD.code != NEW.code
    OR COALESCE(OLD.collection,'') != COALESCE(NEW.collection,'')
  )
  AND EXISTS (
    SELECT 1
    FROM model_gallery_members
    WHERE canonical_model_id = OLD.id
       OR source_model_id = OLD.id
  )
BEGIN
  SELECT RAISE(ABORT, 'gallery member public identity is immutable while attached');
END;

CREATE TRIGGER IF NOT EXISTS trg_gallery_relation_delete_protected
BEFORE DELETE ON model_gallery_members
BEGIN
  SELECT RAISE(ABORT, 'gallery relation deletion requires an explicit migration');
END;
