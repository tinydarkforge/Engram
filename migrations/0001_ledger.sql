CREATE TABLE IF NOT EXISTS assertions (
  id            TEXT PRIMARY KEY,
  plane         TEXT NOT NULL,
  class         TEXT NOT NULL,
  claim         TEXT NOT NULL,
  body          TEXT,
  confidence    REAL NOT NULL DEFAULT 0.5,
  quorum_count  INTEGER NOT NULL DEFAULT 1,
  status        TEXT NOT NULL DEFAULT 'tentative',
  created_at    TEXT NOT NULL,
  last_reinforced TEXT,
  last_verified TEXT,
  staleness_model TEXT NOT NULL DEFAULT 'flat',
  cache_stable  INTEGER NOT NULL DEFAULT 0,
  density_hint  TEXT NOT NULL DEFAULT 'terse'
);

CREATE TABLE IF NOT EXISTS assertion_lineage (
  assertion_id  TEXT NOT NULL,
  source_span   TEXT NOT NULL,
  PRIMARY KEY (assertion_id, source_span),
  FOREIGN KEY (assertion_id) REFERENCES assertions(id)
);

CREATE TABLE IF NOT EXISTS supersession_edges (
  child_id      TEXT NOT NULL,
  parent_id     TEXT NOT NULL,
  kind          TEXT NOT NULL,
  created_at    TEXT NOT NULL,
  PRIMARY KEY (child_id, parent_id)
);

CREATE TABLE IF NOT EXISTS tension_pairs (
  a_id          TEXT NOT NULL,
  b_id          TEXT NOT NULL,
  detected_at   TEXT NOT NULL,
  resolved_at   TEXT,
  resolution    TEXT,
  PRIMARY KEY (a_id, b_id)
);

CREATE TABLE IF NOT EXISTS counterfactual_weights (
  assertion_id  TEXT PRIMARY KEY,
  value         REAL NOT NULL,
  computed_at   TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS schema_migrations (
  version       TEXT PRIMARY KEY,
  applied_at    TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_assertions_plane_status ON assertions(plane, status);
CREATE INDEX IF NOT EXISTS idx_assertions_class ON assertions(class);
CREATE INDEX IF NOT EXISTS idx_supersession_parent ON supersession_edges(parent_id);
CREATE INDEX IF NOT EXISTS idx_supersession_child ON supersession_edges(child_id);
