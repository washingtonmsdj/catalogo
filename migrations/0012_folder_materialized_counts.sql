PRAGMA foreign_keys = ON;

-- Contadores materializados para navegação de pastas em escala.
-- Evitam recontar toda a subárvore de modelos a cada abertura da sidebar.
ALTER TABLE catalog_folders
  ADD COLUMN direct_model_count INTEGER NOT NULL DEFAULT 0 CHECK(direct_model_count >= 0);

ALTER TABLE catalog_folders
  ADD COLUMN subtree_model_count INTEGER NOT NULL DEFAULT 0 CHECK(subtree_model_count >= 0);

UPDATE catalog_folders
SET direct_model_count = (
  SELECT COUNT(*)
  FROM models
  WHERE models.folder_id = catalog_folders.id
    AND models.published = 1
);

UPDATE catalog_folders AS target
SET subtree_model_count = (
  WITH RECURSIVE scope(id) AS (
    SELECT target.id
    UNION ALL
    SELECT child.id
    FROM catalog_folders child
    JOIN scope ON child.parent_id = scope.id
  )
  SELECT COUNT(*)
  FROM models
  WHERE models.published = 1
    AND models.folder_id IN (SELECT id FROM scope)
);

CREATE TRIGGER IF NOT EXISTS trg_folder_counts_after_model_insert
AFTER INSERT ON models
WHEN NEW.published = 1 AND NEW.folder_id IS NOT NULL
BEGIN
  UPDATE catalog_folders
  SET direct_model_count = direct_model_count + 1
  WHERE id = NEW.folder_id;

  UPDATE catalog_folders
  SET subtree_model_count = subtree_model_count + 1
  WHERE id IN (
    WITH RECURSIVE ancestors(id,parent_id) AS (
      SELECT id,parent_id FROM catalog_folders WHERE id = NEW.folder_id
      UNION ALL
      SELECT parent.id,parent.parent_id
      FROM catalog_folders parent
      JOIN ancestors child ON child.parent_id = parent.id
    )
    SELECT id FROM ancestors
  );
END;

CREATE TRIGGER IF NOT EXISTS trg_folder_counts_after_model_delete
AFTER DELETE ON models
WHEN OLD.published = 1 AND OLD.folder_id IS NOT NULL
BEGIN
  UPDATE catalog_folders
  SET direct_model_count = MAX(0, direct_model_count - 1)
  WHERE id = OLD.folder_id;

  UPDATE catalog_folders
  SET subtree_model_count = MAX(0, subtree_model_count - 1)
  WHERE id IN (
    WITH RECURSIVE ancestors(id,parent_id) AS (
      SELECT id,parent_id FROM catalog_folders WHERE id = OLD.folder_id
      UNION ALL
      SELECT parent.id,parent.parent_id
      FROM catalog_folders parent
      JOIN ancestors child ON child.parent_id = parent.id
    )
    SELECT id FROM ancestors
  );
END;

CREATE TRIGGER IF NOT EXISTS trg_folder_counts_after_model_update
AFTER UPDATE OF published,folder_id ON models
WHEN OLD.published != NEW.published OR COALESCE(OLD.folder_id,-1) != COALESCE(NEW.folder_id,-1)
BEGIN
  UPDATE catalog_folders
  SET direct_model_count = MAX(0, direct_model_count - CASE WHEN OLD.published = 1 THEN 1 ELSE 0 END)
  WHERE id = OLD.folder_id;

  UPDATE catalog_folders
  SET subtree_model_count = MAX(0, subtree_model_count - CASE WHEN OLD.published = 1 THEN 1 ELSE 0 END)
  WHERE OLD.folder_id IS NOT NULL
    AND id IN (
      WITH RECURSIVE ancestors(id,parent_id) AS (
        SELECT id,parent_id FROM catalog_folders WHERE id = OLD.folder_id
        UNION ALL
        SELECT parent.id,parent.parent_id
        FROM catalog_folders parent
        JOIN ancestors child ON child.parent_id = parent.id
      )
      SELECT id FROM ancestors
    );

  UPDATE catalog_folders
  SET direct_model_count = direct_model_count + CASE WHEN NEW.published = 1 THEN 1 ELSE 0 END
  WHERE id = NEW.folder_id;

  UPDATE catalog_folders
  SET subtree_model_count = subtree_model_count + CASE WHEN NEW.published = 1 THEN 1 ELSE 0 END
  WHERE NEW.folder_id IS NOT NULL
    AND id IN (
      WITH RECURSIVE ancestors(id,parent_id) AS (
        SELECT id,parent_id FROM catalog_folders WHERE id = NEW.folder_id
        UNION ALL
        SELECT parent.id,parent.parent_id
        FROM catalog_folders parent
        JOIN ancestors child ON child.parent_id = parent.id
      )
      SELECT id FROM ancestors
    );
END;

CREATE INDEX IF NOT EXISTS idx_models_franchise_published_image_name
  ON models(franchise_id, published, image_count DESC, name COLLATE NOCASE, id);
