PRAGMA foreign_keys = ON;

-- A agregação de galerias é estritamente de um nível:
-- canonical -> source. Não permitimos cadeias/ciclos ou relações entre
-- modelos de escopos incompatíveis.
--
-- IMPORTANTE: os guards usam SELECT RAISE(...) WHERE ... em vez de
-- SELECT CASE ... END. O runner de migrations D1 segmenta triggers pelo
-- terminador END; e um END; interno de CASE pode gerar "incomplete input".
CREATE TRIGGER IF NOT EXISTS trg_gallery_members_validate_insert
BEFORE INSERT ON model_gallery_members
BEGIN
  SELECT RAISE(ABORT, 'gallery canonical cannot already be a source')
  WHERE EXISTS (
    SELECT 1
    FROM model_gallery_members
    WHERE source_model_id = NEW.canonical_model_id
  );

  SELECT RAISE(ABORT, 'gallery source cannot already be a canonical')
  WHERE EXISTS (
    SELECT 1
    FROM model_gallery_members
    WHERE canonical_model_id = NEW.source_model_id
  );

  SELECT RAISE(ABORT, 'gallery members must share franchise folder and public name')
  WHERE NOT EXISTS (
    SELECT 1
    FROM models canonical
    JOIN models source ON source.id = NEW.source_model_id
    WHERE canonical.id = NEW.canonical_model_id
      AND canonical.franchise_id = source.franchise_id
      AND COALESCE(canonical.folder_id, -1) = COALESCE(source.folder_id, -1)
      AND lower(trim(canonical.name)) = lower(trim(source.name))
  );
END;

CREATE TRIGGER IF NOT EXISTS trg_gallery_members_validate_update
BEFORE UPDATE OF canonical_model_id, source_model_id ON model_gallery_members
BEGIN
  SELECT RAISE(ABORT, 'gallery canonical cannot already be a source')
  WHERE EXISTS (
    SELECT 1
    FROM model_gallery_members
    WHERE source_model_id = NEW.canonical_model_id
      AND NOT (
        canonical_model_id = OLD.canonical_model_id
        AND source_model_id = OLD.source_model_id
      )
  );

  SELECT RAISE(ABORT, 'gallery source cannot already be a canonical')
  WHERE EXISTS (
    SELECT 1
    FROM model_gallery_members
    WHERE canonical_model_id = NEW.source_model_id
      AND NOT (
        canonical_model_id = OLD.canonical_model_id
        AND source_model_id = OLD.source_model_id
      )
  );

  SELECT RAISE(ABORT, 'gallery members must share franchise folder and public name')
  WHERE NOT EXISTS (
    SELECT 1
    FROM models canonical
    JOIN models source ON source.id = NEW.source_model_id
    WHERE canonical.id = NEW.canonical_model_id
      AND canonical.franchise_id = source.franchise_id
      AND COALESCE(canonical.folder_id, -1) = COALESCE(source.folder_id, -1)
      AND lower(trim(canonical.name)) = lower(trim(source.name))
  );
END;
