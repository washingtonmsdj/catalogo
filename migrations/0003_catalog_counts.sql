PRAGMA foreign_keys = ON;

-- Backfill current counters before enabling incremental maintenance.
UPDATE franchises
SET model_count = (
  SELECT COUNT(*)
  FROM models
  WHERE models.franchise_id = franchises.id
    AND models.published = 1
);

UPDATE categories
SET model_count = (
  SELECT COUNT(*)
  FROM models
  JOIN franchises ON franchises.id = models.franchise_id
  WHERE franchises.category_id = categories.id
    AND models.published = 1
);

CREATE TRIGGER IF NOT EXISTS trg_models_count_after_insert
AFTER INSERT ON models
WHEN NEW.published = 1
BEGIN
  UPDATE franchises
  SET model_count = model_count + 1
  WHERE id = NEW.franchise_id;

  UPDATE categories
  SET model_count = model_count + 1
  WHERE id = (SELECT category_id FROM franchises WHERE id = NEW.franchise_id);
END;

CREATE TRIGGER IF NOT EXISTS trg_models_count_after_delete
AFTER DELETE ON models
WHEN OLD.published = 1
BEGIN
  UPDATE franchises
  SET model_count = MAX(0, model_count - 1)
  WHERE id = OLD.franchise_id;

  UPDATE categories
  SET model_count = MAX(0, model_count - 1)
  WHERE id = (SELECT category_id FROM franchises WHERE id = OLD.franchise_id);
END;

CREATE TRIGGER IF NOT EXISTS trg_models_count_after_update
AFTER UPDATE OF published, franchise_id ON models
WHEN OLD.published != NEW.published OR OLD.franchise_id != NEW.franchise_id
BEGIN
  UPDATE franchises
  SET model_count = MAX(0, model_count - CASE WHEN OLD.published = 1 THEN 1 ELSE 0 END)
  WHERE id = OLD.franchise_id;

  UPDATE categories
  SET model_count = MAX(0, model_count - CASE WHEN OLD.published = 1 THEN 1 ELSE 0 END)
  WHERE id = (SELECT category_id FROM franchises WHERE id = OLD.franchise_id);

  UPDATE franchises
  SET model_count = model_count + CASE WHEN NEW.published = 1 THEN 1 ELSE 0 END
  WHERE id = NEW.franchise_id;

  UPDATE categories
  SET model_count = model_count + CASE WHEN NEW.published = 1 THEN 1 ELSE 0 END
  WHERE id = (SELECT category_id FROM franchises WHERE id = NEW.franchise_id);
END;

CREATE TRIGGER IF NOT EXISTS trg_franchise_category_count_after_update
AFTER UPDATE OF category_id ON franchises
WHEN OLD.category_id != NEW.category_id
BEGIN
  UPDATE categories
  SET model_count = MAX(0, model_count - OLD.model_count)
  WHERE id = OLD.category_id;

  UPDATE categories
  SET model_count = model_count + NEW.model_count
  WHERE id = NEW.category_id;
END;
