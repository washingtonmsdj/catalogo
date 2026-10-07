PRAGMA foreign_keys = ON;

-- Revisão pública monotônica da galeria.
-- gallery_version continua sendo a versão do manifesto físico de cada modelo.
-- public_gallery_version representa qualquer mudança observável na galeria
-- pública, inclusive composição/ordem de fontes legadas.
ALTER TABLE models
  ADD COLUMN public_gallery_version INTEGER NOT NULL DEFAULT 1
  CHECK(public_gallery_version >= 1 AND public_gallery_version < 9007199254740991);

CREATE TRIGGER IF NOT EXISTS trg_public_gallery_revision_after_model_gallery_update
AFTER UPDATE OF image_count,cover_storage_key,gallery_manifest_key,gallery_version ON models
WHEN OLD.image_count != NEW.image_count
  OR COALESCE(OLD.cover_storage_key,'') != COALESCE(NEW.cover_storage_key,'')
  OR COALESCE(OLD.gallery_manifest_key,'') != COALESCE(NEW.gallery_manifest_key,'')
  OR OLD.gallery_version != NEW.gallery_version
BEGIN
  UPDATE models
  SET public_gallery_version = public_gallery_version + 1
  WHERE id = NEW.id;

  UPDATE models
  SET public_gallery_version = public_gallery_version + 1
  WHERE id = (
    SELECT canonical_model_id
    FROM model_gallery_members
    WHERE source_model_id = NEW.id
  );
END;

CREATE TRIGGER IF NOT EXISTS trg_public_gallery_revision_after_member_insert
AFTER INSERT ON model_gallery_members
BEGIN
  UPDATE models
  SET public_gallery_version = public_gallery_version + 1
  WHERE id = NEW.canonical_model_id;
END;

CREATE TRIGGER IF NOT EXISTS trg_public_gallery_revision_after_member_delete
AFTER DELETE ON model_gallery_members
BEGIN
  UPDATE models
  SET public_gallery_version = public_gallery_version + 1
  WHERE id = OLD.canonical_model_id;
END;

CREATE TRIGGER IF NOT EXISTS trg_public_gallery_revision_after_member_reorder
AFTER UPDATE OF position ON model_gallery_members
WHEN OLD.position != NEW.position
BEGIN
  UPDATE models
  SET public_gallery_version = public_gallery_version + 1
  WHERE id = NEW.canonical_model_id;
END;
