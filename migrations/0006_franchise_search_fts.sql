PRAGMA foreign_keys = ON;

-- Busca indexada de franquias para o navegador do acervo.
-- Trigram permite pesquisa parcial ("resi" -> "Resident Evil") e remove
-- diacríticos ("pokemon" -> "Pokémon") sem varrer a tabela inteira.
CREATE VIRTUAL TABLE IF NOT EXISTS franchises_fts USING fts5(
  franchise_id UNINDEXED,
  search_text,
  tokenize='trigram remove_diacritics 1'
);

INSERT INTO franchises_fts(franchise_id, search_text)
SELECT id, name || ' ' || slug FROM franchises;

CREATE TRIGGER IF NOT EXISTS trg_franchises_fts_after_insert
AFTER INSERT ON franchises
BEGIN
  INSERT INTO franchises_fts(franchise_id, search_text)
  VALUES (NEW.id, NEW.name || ' ' || NEW.slug);
END;

CREATE TRIGGER IF NOT EXISTS trg_franchises_fts_after_delete
AFTER DELETE ON franchises
BEGIN
  DELETE FROM franchises_fts WHERE franchise_id = OLD.id;
END;

CREATE TRIGGER IF NOT EXISTS trg_franchises_fts_after_update
AFTER UPDATE OF id, name, slug ON franchises
BEGIN
  DELETE FROM franchises_fts WHERE franchise_id = OLD.id;
  INSERT INTO franchises_fts(franchise_id, search_text)
  VALUES (NEW.id, NEW.name || ' ' || NEW.slug);
END;
