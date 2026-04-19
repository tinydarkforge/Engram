CREATE UNIQUE INDEX IF NOT EXISTS idx_outcomes_dedup
  ON assertion_outcomes(assertion_id, session_id, signal_source, reply_hash);
