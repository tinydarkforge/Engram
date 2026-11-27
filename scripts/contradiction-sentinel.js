'use strict';
// Contradiction Sentinel — samples assertion pairs and seeds tension_pairs for contradictions
// Exports: scanPlane(plane, { sampleSize, threshold }) => { tensions_found }
// CLI: node scripts/contradiction-sentinel.js --plane <plane> [--sample-size <n>]

const { detectNegation } = require('./dedup');

function createSentinel(getLedgerFn, getDb) {
  function ensureTables() {
    const db = getDb();
    db.exec(`CREATE TABLE IF NOT EXISTS sentinel_watermark (
      plane TEXT PRIMARY KEY,
      last_scanned_at TEXT NOT NULL
    )`);
    db.exec(`CREATE TABLE IF NOT EXISTS sentinel_checked (
      assertion_id TEXT PRIMARY KEY
    )`);
  }

  function getWatermark(plane) {
    try {
      const db = getDb();
      const row = db.prepare(
        'SELECT last_scanned_at FROM sentinel_watermark WHERE plane = ?'
      ).get(plane);
      return row ? row.last_scanned_at : null;
    } catch {
      try { ensureTables(); } catch { /* table may already exist */ }
      return null;
    }
  }

  function setWatermark(plane, timestamp) {
    const db = getDb();
    db.prepare(
      `INSERT OR REPLACE INTO sentinel_watermark (plane, last_scanned_at) VALUES (?, ?)`
    ).run(plane, timestamp);
  }

  function markChecked(ids) {
    if (ids.length === 0) return;
    const db = getDb();
    const stmt = db.prepare('INSERT OR IGNORE INTO sentinel_checked (assertion_id) VALUES (?)');
    const tx = db.transaction((rows) => { for (const id of rows) stmt.run(id); });
    tx(ids);
  }

  function isChecked(id) {
    const db = getDb();
    return !!db.prepare('SELECT 1 FROM sentinel_checked WHERE assertion_id = ?').get(id);
  }

  async function scanPlane(plane, { sampleSize = 50, threshold = 0.7 } = {}) {
    const ledger = getLedgerFn();
    const watermark = getWatermark(plane);
    const now = new Date().toISOString();

    const rows = ledger.queryActiveByPlane(plane, {
      limit: sampleSize * 2,
      since: watermark ?? undefined,
    });

    if (rows.length === 0) {
      setWatermark(plane, now);
      const active = ledger.queryActiveByPlane(plane, { limit: sampleSize * 2 });
      const activeIds = new Set(active.map((row) => row.id));
      const storedTensions = ledger.queryTensions().filter((pair) =>
        activeIds.has(pair.a_id) && activeIds.has(pair.b_id)
      );
      return {
        tensions_found: storedTensions.length,
        skipped: true,
        reason: 'no new assertions since last scan'
      };
    }

    // Filter to only un-checked assertions
    const unChecked = rows.filter((r) => !isChecked(r.id));
    if (unChecked.length === 0) {
      setWatermark(plane, now);
      const active = ledger.queryActiveByPlane(plane, { limit: sampleSize * 2 });
      const activeIds = new Set(active.map((row) => row.id));
      const storedTensions = ledger.queryTensions().filter((pair) =>
        activeIds.has(pair.a_id) && activeIds.has(pair.b_id)
      );
      return {
        tensions_found: storedTensions.length,
        skipped: true,
        reason: 'all new assertions already checked'
      };
    }

    let sample = unChecked;
    if (unChecked.length > sampleSize) {
      sample = unChecked.slice();
      for (let i = sample.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [sample[i], sample[j]] = [sample[j], sample[i]];
      }
      sample = sample.slice(0, sampleSize);
    }

    // Fetch baseline of previously-scanned assertions for cross-temporal comparison
    let baseline = [];
    if (watermark) {
      baseline = ledger.queryActiveByPlane(plane, { limit: sampleSize });
    }

    let tensions_found = 0;

    // Compare new assertions against the baseline (catches cross-temporal contradictions)
    for (let i = 0; i < sample.length; i++) {
      for (let j = 0; j < baseline.length; j++) {
        if (detectNegation(sample[i].claim, baseline[j].claim, threshold)) {
          ledger.linkSupersession(sample[i].id, baseline[j].id, 'contradicts');
          ledger.linkSupersession(baseline[j].id, sample[i].id, 'contradicts');
          tensions_found += 1;
        }
      }
    }

    // Compare new assertions among themselves
    for (let i = 0; i < sample.length; i++) {
      for (let j = i + 1; j < sample.length; j++) {
        if (detectNegation(sample[i].claim, sample[j].claim, threshold)) {
          ledger.linkSupersession(sample[i].id, sample[j].id, 'contradicts');
          ledger.linkSupersession(sample[j].id, sample[i].id, 'contradicts');
          tensions_found += 1;
        }
      }
    }

    // Mark all checked assertions so they are never re-scanned
    markChecked(sample.map((r) => r.id));
    setWatermark(plane, now);

    return { tensions_found, new_assertions: rows.length, checked: sample.length };
  }

  return { scanPlane };
}

async function autoResolve(plane, { maxAgeDays = 30 } = {}) {
  const ledger = require('./ledger');
  const db = ledger.getDb();
  const cutoff = new Date(Date.now() - maxAgeDays * 24 * 60 * 60 * 1000).toISOString();

  const staleTensions = db.prepare(`
    SELECT a_id, b_id FROM tension_pairs
    WHERE resolved_at IS NULL AND detected_at < ?
  `).all(cutoff);

  let resolved = 0;
  for (const t of staleTensions) {
    const ok = ledger.resolveTension(t.a_id, t.b_id, 'auto_resolved_stale');
    if (ok) resolved++;
  }

  return { plane, resolved, total_stale: staleTensions.length };
}

// Production singleton backed by real ledger
let _sentinel = null;
function getSentinel() {
  if (!_sentinel) {
    const ledger = require('./ledger');
    _sentinel = createSentinel(() => ledger, () => ledger.getDb());
  }
  return _sentinel;
}

function scanPlane(plane, opts) {
  return getSentinel().scanPlane(plane, opts);
}

module.exports = {
  scanPlane,
  autoResolve,
  _createForTesting: (ledger, getDb) => createSentinel(() => ledger, getDb),
};

if (require.main === module) {
  const args = process.argv.slice(2);
  let plane = null;
  let sampleSize = 50;
  let threshold = 0.7;

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--plane' && args[i + 1]) {
      plane = args[++i];
    } else if (args[i] === '--sample-size' && args[i + 1]) {
      sampleSize = parseInt(args[++i], 10);
    } else if (args[i] === '--threshold' && args[i + 1]) {
      threshold = parseFloat(args[++i]);
    }
  }

  if (!plane) {
    console.error('Usage: node contradiction-sentinel.js --plane <plane> [--sample-size <n>] [--threshold <f>]');
    process.exit(1);
  }

  scanPlane(plane, { sampleSize, threshold })
    .then(result => console.log(JSON.stringify(result, null, 2)))
    .catch(err => {
      console.error(err.message);
      process.exit(1);
    });
}
