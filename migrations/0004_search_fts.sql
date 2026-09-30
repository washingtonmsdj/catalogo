PRAGMA foreign_keys = ON;

-- Trigram FTS preserves arbitrary substring search without scanning every model.
-- model_id is stored for the join but is not itself indexed as full text.
CREATE VIRTUAL TABLE IF NOT EXISTS models_fts USING fts5(
  model_id UNINDEXED,
  search_text,
  tokenize='trigram'
);

-- Migration runs once; seed the search index from all current models.
INSERT INTO models_fts(model_id, search_text)
SELECT id, search_text FROM models;

CREATE TRIGGER IF NOT EXISTS trg_models_fts_after_insert
AFTER INSERT ON models
BEGIN
  INSERT INTO models_fts(model_id, search_text)
  VALUES (NEW.id, NEW.search_text);
END;

CREATE TRIGGER IF NOT EXISTS trg_models_fts_after_delete
AFTER DELETE ON models
BEGIN
  DELETE FROM models_fts WHERE model_id = OLD.id;
END;

CREATE TRIGGER IF NOT EXISTS trg_models_fts_after_update
AFTER UPDATE OF id, search_text ON models
BEGIN
  DELETE FROM models_fts WHERE model_id = OLD.id;
  INSERT INTO models_fts(model_id, search_text)
  VALUES (NEW.id, NEW.search_text);
END;
