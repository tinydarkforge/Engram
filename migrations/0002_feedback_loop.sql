CREATE TABLE IF NOT EXISTS selection_log (
  id             TEXT PRIMARY KEY,
  session_id     TEXT NOT NULL,
  assertion_id   TEXT NOT NULL,
  selected_at    TEXT NOT NULL,
  budget         INTEGER,
  score          REAL,
  FOREIGN KEY (assertion_id) REFERENCES assertions(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_selection_log_session ON selection_log(session_id);
CREATE INDEX IF NOT EXISTS idx_selection_log_assertion ON selection_log(assertion_id);
CREATE INDEX IF NOT EXISTS idx_selection_log_time ON selection_log(selected_at);

CREATE TABLE IF NOT EXISTS assertion_outcomes (
  id             TEXT PRIMARY KEY,
  assertion_id   TEXT NOT NULL,
  session_id     TEXT NOT NULL,
  selected_at    TEXT NOT NULL,
  scored_at      TEXT,
  signal_source  TEXT NOT NULL CHECK (signal_source IN ('post_hoc', 'citation', 'user')),
  score          REAL NOT NULL CHECK (score >= 0.0 AND score <= 1.0),
  note           TEXT,
  agent_id       TEXT,
  reply_hash     TEXT,
  FOREIGN KEY (assertion_id) REFERENCES assertions(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_outcomes_assertion ON assertion_outcomes(assertion_id);
CREATE INDEX IF NOT EXISTS idx_outcomes_session ON assertion_outcomes(session_id);
CREATE INDEX IF NOT EXISTS idx_outcomes_source ON assertion_outcomes(signal_source);
