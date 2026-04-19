'use strict';
// Computes per-assertion outcome priors from the assertion_outcomes table.
// Cold-start (< MIN_EVENTS rows): returns 1.0 (neutral).
// Warm: returns clamp(avg * 2, 0.1, 2.0).
// avg=0.5 → 1.0 (neutral), avg=1.0 → 2.0 (boost), avg=0.1 → 0.2 (reduced).

const MIN_EVENTS = 5;

function computeOutcomePriors(db, assertionIds) {
  if (!db || !assertionIds || assertionIds.length === 0) return new Map();

  const placeholders = assertionIds.map(() => '?').join(', ');
  const rows = db.prepare(`
    SELECT assertion_id, AVG(score) AS avg_score, COUNT(*) AS event_count
    FROM assertion_outcomes
    WHERE assertion_id IN (${placeholders})
    GROUP BY assertion_id
  `).all(...assertionIds);

  const result = new Map();
  const rowMap = new Map(rows.map(r => [r.assertion_id, r]));

  for (const id of assertionIds) {
    const row = rowMap.get(id);
    if (!row || row.event_count < MIN_EVENTS) {
      result.set(id, 1.0);
    } else {
      const prior = Math.max(0.1, Math.min(2.0, row.avg_score * 2));
      result.set(id, prior);
    }
  }

  return result;
}

module.exports = { computeOutcomePriors, MIN_EVENTS };
