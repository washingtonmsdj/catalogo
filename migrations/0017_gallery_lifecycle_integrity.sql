PRAGMA foreign_keys = ON;

-- Integridade de ciclo de vida das galerias consolidadas.
-- A relação model_gallery_members representa identidade histórica permanente,
-- portanto mudanças destrutivas ou que quebrem o escopo exigem desmontagem
-- explícita e auditada da relação antes.
CREATE TRIGGER IF NOT EXISTS trg_gallery_member_source_must_be_active
BEFORE INSERT ON model_gallery_members
WHEN NOT EXISTS (
  SELECT 1
  FROM models
  WHERE id = NEW.source_model_id
    AND published = 1
)
BEGIN
  SELECT RAISE(ABORT, 'gallery source must be published before attachment');
END;

CREATE TRIGGER IF NOT EXISTS trg_gallery_canonical_cannot_retire_with_members
BEFORE UPDATE OF published ON models
WHEN OLD.published = 1
  AND NEW.published = 0
  AND EXISTS (
    SELECT 1
    FROM model_gallery_members
    WHERE canonical_model_id = NEW.id
  )
BEGIN
  SELECT RAISE(ABORT, 'gallery canonical cannot retire while members are attached');
END;

CREATE TRIGGER IF NOT EXISTS trg_gallery_member_scope_immutable
BEFORE UPDATE OF franchise_id,folder_id,name ON models
WHEN (
    OLD.franchise_id != NEW.franchise_id
    OR COALESCE(OLD.folder_id,-1) != COALESCE(NEW.folder_id,-1)
    OR lower(trim(OLD.name)) != lower(trim(NEW.name))
  )
  AND EXISTS (
    SELECT 1
    FROM model_gallery_members
    WHERE canonical_model_id = OLD.id
       OR source_model_id = OLD.id
  )
BEGIN
  SELECT RAISE(ABORT, 'gallery member scope is immutable while attached');
END;

CREATE TRIGGER IF NOT EXISTS trg_gallery_member_model_delete_protected
BEFORE DELETE ON models
WHEN EXISTS (
  SELECT 1
  FROM model_gallery_members
  WHERE canonical_model_id = OLD.id
     OR source_model_id = OLD.id
)
BEGIN
  SELECT RAISE(ABORT, 'gallery member model cannot be deleted while attached');
END;
