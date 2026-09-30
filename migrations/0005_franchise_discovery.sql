PRAGMA foreign_keys = ON;

-- A faixa de franquias da UI nunca deve exigir leitura/ordenação de toda a taxonomia.
-- Estes índices suportam o recorte por categoria e o ranking por quantidade de modelos.
CREATE INDEX IF NOT EXISTS idx_franchises_category_discovery
  ON franchises(category_id, model_count DESC, name COLLATE NOCASE, id);

CREATE INDEX IF NOT EXISTS idx_franchises_global_discovery
  ON franchises(model_count DESC, name COLLATE NOCASE, id);
