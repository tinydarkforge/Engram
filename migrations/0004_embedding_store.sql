CREATE TABLE IF NOT EXISTS embedding_items (
  vec_rowid     INTEGER PRIMARY KEY,
  entity_type   TEXT NOT NULL,
  entity_id     TEXT NOT NULL,
  project       TEXT,
  text_preview  TEXT,
  embedding_json TEXT,
  model         TEXT NOT NULL DEFAULT 'all-MiniLM-L6-v2',
  dimensions    INTEGER NOT NULL,
  updated_at    TEXT NOT NULL,
  UNIQUE(entity_type, entity_id)
);

CREATE INDEX IF NOT EXISTS idx_embedding_items_project
  ON embedding_items(project);
CREATE INDEX IF NOT EXISTS idx_embedding_items_entity
  ON embedding_items(entity_type, entity_id);

CREATE VIRTUAL TABLE IF NOT EXISTS vec_embeddings
  USING vec0(embedding float[384]);
