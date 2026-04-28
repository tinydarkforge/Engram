'use strict';
// Post-hoc attribution scorer (layer A signal)
// scoreSession({ sessionId, replyText, db, embedFn }) => { scored, skipped }
//
// embedFn(text) => Promise<number[]> — injectable; production uses VectorSearch.
// Phase 1 (async): embed reply + each assertion text.
// Phase 2 (sync txn): write assertion_outcomes rows with signal_source='post_hoc'.

const crypto = require('crypto');
const { renderAssertion } = require('../render');

function cosineSimilarity(a, b) {
  if (!a.length || a.length !== b.length) return 0;
  let dot = 0, magA = 0, magB = 0;
  for (let i = 0; i < a.length; i++) {
    dot  += a[i] * b[i];
    magA += a[i] * a[i];
    magB += b[i] * b[i];
  }
  const denom = Math.sqrt(magA) * Math.sqrt(magB);
  return denom === 0 ? 0 : dot / denom;
}

function newId() {
  return `ao_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`;
}

async function scoreSession({ sessionId, replyText, db, embedFn }) {
  if (!sessionId) throw new Error('scoreSession: sessionId is required');
  if (typeof replyText !== 'string') throw new Error('scoreSession: replyText must be a string');
  if (!db) throw new Error('scoreSession: db is required');
  if (typeof embedFn !== 'function') throw new Error('scoreSession: embedFn is required');

  const picks = db.prepare(`
    SELECT sl.assertion_id, sl.selected_at,
           a.claim, a.body, a.class AS class, a.density_hint,
           a.status, a.confidence, a.quorum_count, a.last_verified
    FROM selection_log sl
    JOIN assertions a ON a.id = sl.assertion_id
    WHERE sl.session_id = ?
  `).all(sessionId);

  if (picks.length === 0) return { scored: 0, skipped: 0 };

  // Phase 1: async embeddings
  const replyVec = await embedFn(replyText);
  const replyHash = crypto.createHash('sha256').update(replyText).digest('hex').slice(0, 32);
  const scoredAt = new Date().toISOString();

  const rows = [];
  for (const pick of picks) {
    const text = renderAssertion(pick);
    const vec = await embedFn(text);
    const raw = cosineSimilarity(replyVec, vec);
    rows.push({
      id: newId(),
      assertion_id: pick.assertion_id,
      selected_at: pick.selected_at,
      score: Math.max(0, Math.min(1, raw)),
    });
  }

  // Phase 2: single sync transaction
  const insert = db.prepare(`
    INSERT OR IGNORE INTO assertion_outcomes
      (id, assertion_id, session_id, selected_at, scored_at, signal_source, score, reply_hash)
    VALUES (?, ?, ?, ?, ?, 'post_hoc', ?, ?)
  `);

  let scored = 0;
  let skipped = 0;

  db.transaction(() => {
    for (const r of rows) {
      const res = insert.run(r.id, r.assertion_id, sessionId, r.selected_at, scoredAt, r.score, replyHash);
      if (res.changes > 0) scored++;
      else skipped++;
    }
  })();

  return { scored, skipped };
}

module.exports = { scoreSession, cosineSimilarity };
