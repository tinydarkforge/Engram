'use strict';
// Citation scorer — layer B signal
// scoreCitations({ sessionId, replyText, db }) => { scored, skipped }

const crypto = require('crypto');
const { parseCitations } = require('./citation');

function newId() {
  return `ao_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`;
}

function scoreCitations({ sessionId, replyText, db }) {
  if (!sessionId) throw new Error('scoreCitations: sessionId is required');
  if (typeof replyText !== 'string') throw new Error('scoreCitations: replyText must be a string');
  if (!db) throw new Error('scoreCitations: db is required');

  const citedIds = parseCitations(replyText);
  if (citedIds.length === 0) return { scored: 0, skipped: 0 };

  const replyHash = crypto.createHash('sha1').update(replyText).digest('hex').slice(0, 16);
  const scoredAt = new Date().toISOString();

  // Fetch selection_log rows for this session that match cited IDs
  const placeholders = citedIds.map(() => '?').join(', ');
  const picks = db.prepare(`
    SELECT sl.assertion_id, sl.selected_at
    FROM selection_log sl
    JOIN assertions a ON a.id = sl.assertion_id
    WHERE sl.session_id = ?
      AND sl.assertion_id IN (${placeholders})
  `).all(sessionId, ...citedIds);

  if (picks.length === 0) return { scored: 0, skipped: 0 };

  const insert = db.prepare(`
    INSERT OR IGNORE INTO assertion_outcomes
      (id, assertion_id, session_id, selected_at, scored_at, signal_source, score, reply_hash)
    VALUES (?, ?, ?, ?, ?, 'citation', 1.0, ?)
  `);

  let scored = 0;
  let skipped = 0;

  db.transaction(() => {
    for (const pick of picks) {
      const res = insert.run(newId(), pick.assertion_id, sessionId, pick.selected_at, scoredAt, replyHash);
      if (res.changes > 0) scored++;
      else skipped++;
    }
  })();

  return { scored, skipped };
}

module.exports = { scoreCitations };
