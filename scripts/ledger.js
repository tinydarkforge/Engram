'use strict';
// Ledger — single gateway for reading and writing assertions to SQLite
// Exports: createAssertion, reinforceAssertion, maybePromote, linkSupersession,
//          markFossilized, quarantine, getAssertion, queryActiveByPlane,
//          queryByClaim, queryTensions, setCounterfactualWeight, stats, ingest

const Database = require('better-sqlite3');
const crypto = require('crypto');
const path = require('path');
const fs = require('fs');
const { resolveEngramPath } = require('./paths');
const { findNearDuplicate, findNegations } = require('./dedup');
const { rankAssertions, selectForContext: _selectForContext } = require('./rank');
const { computeOutcomePriors } = require('./feedback/outcome-prior');

const ENGRAM_PATH = resolveEngramPath(__dirname);
const DB_PATH = path.join(ENGRAM_PATH, '.cache', 'engram.db');

let _db = null;

function getDb() {
  if (!_db) {
    const cacheDir = path.dirname(DB_PATH);
    if (!fs.existsSync(cacheDir)) fs.mkdirSync(cacheDir, { recursive: true });
    _db = new Database(DB_PATH);
    _db.pragma('foreign_keys = ON');
  }
  return _db;
}

function newId() {
  return `a_${Date.now()}_${crypto.randomBytes(3).toString('hex')}`;
}

function now() {
  return new Date().toISOString();
}

// Factory: all logic lives here, getDbFn is injected so tests can pass an
// in-memory DB without touching the file on disk.
function createLedger(getDbFn) {
  // -------------------------------------------------------------------------
  // createAssertion
  // -------------------------------------------------------------------------
  function createAssertion(params) {
    const {
      plane,
      class_,
      claim,
      body,
      confidence = 0.5,
      staleness_model = 'flat',
      source_spans,
      density_hint = 'terse',
      cache_stable = 0,
    } = params || {};

    if (!plane) throw new Error('createAssertion: plane is required');
    if (!class_) throw new Error('createAssertion: class_ is required');
    if (!claim) throw new Error('createAssertion: claim is required');
    if (!Array.isArray(source_spans) || source_spans.length === 0) {
      throw new Error('createAssertion: source_spans must be a non-empty array');
    }

    const db = getDbFn();
    const id = newId();
    const ts = now();

    const insertAssertion = db.prepare(`
      INSERT INTO assertions
        (id, plane, class, claim, body, confidence, quorum_count, status,
         created_at, staleness_model, cache_stable, density_hint)
      VALUES
        (?, ?, ?, ?, ?, ?, 1, 'tentative', ?, ?, ?, ?)
    `);

    const insertLineage = db.prepare(`
      INSERT INTO assertion_lineage (assertion_id, source_span) VALUES (?, ?)
    `);

    const txn = db.transaction(() => {
      insertAssertion.run(
        id, plane, class_, claim,
        body !== undefined ? body : null,
        confidence, ts, staleness_model, cache_stable, density_hint
      );
      for (const span of source_spans) {
        insertLineage.run(id, span);
      }
    });

    txn();
    return id;
  }

  // -------------------------------------------------------------------------
  // reinforceAssertion
  // -------------------------------------------------------------------------
  function reinforceAssertion(id, { source_span, confidence_delta } = {}) {
    const db = getDbFn();

    const row = db.prepare('SELECT quorum_count, confidence FROM assertions WHERE id = ?').get(id);
    if (!row) throw new Error(`reinforceAssertion: assertion not found: ${id}`);

    const ts = now();

    const updateQuorum = db.prepare(`
      UPDATE assertions
      SET quorum_count = quorum_count + 1,
          last_reinforced = ?
      WHERE id = ?
    `);

    const updateConfidence = db.prepare(`
      UPDATE assertions
      SET confidence = MIN(1.0, confidence + ?)
      WHERE id = ?
    `);

    const insertLineage = db.prepare(`
      INSERT OR IGNORE INTO assertion_lineage (assertion_id, source_span) VALUES (?, ?)
    `);

    const txn = db.transaction(() => {
      updateQuorum.run(ts, id);
      if (confidence_delta !== undefined && confidence_delta > 0) {
        updateConfidence.run(confidence_delta, id);
      }
      if (source_span !== undefined) {
        insertLineage.run(id, source_span);
      }
    });

    txn();
  }

  // -------------------------------------------------------------------------
  // maybePromote
  // -------------------------------------------------------------------------
  function maybePromote(id, quorumThreshold = 2) {
    const db = getDbFn();

    const row = db.prepare('SELECT quorum_count, status FROM assertions WHERE id = ?').get(id);
    if (!row) return false;

    if (row.status === 'tentative' && row.quorum_count >= quorumThreshold) {
      db.prepare("UPDATE assertions SET status = 'established' WHERE id = ?").run(id);
      return true;
    }
    return false;
  }

  // -------------------------------------------------------------------------
  // linkSupersession
  // -------------------------------------------------------------------------
  function linkSupersession(childId, parentId, kind) {
    const db = getDbFn();

    const childRow = db.prepare('SELECT id FROM assertions WHERE id = ?').get(childId);
    if (!childRow) throw new Error(`linkSupersession: child assertion not found: ${childId}`);

    const parentRow = db.prepare('SELECT id FROM assertions WHERE id = ?').get(parentId);
    if (!parentRow) throw new Error(`linkSupersession: parent assertion not found: ${parentId}`);

    const ts = now();

    const insertEdge = db.prepare(`
      INSERT OR IGNORE INTO supersession_edges (child_id, parent_id, kind, created_at)
      VALUES (?, ?, ?, ?)
    `);

    const checkTension = db.prepare(`
      SELECT a_id FROM tension_pairs
      WHERE (a_id = ? AND b_id = ?) OR (a_id = ? AND b_id = ?)
    `);

    const insertTension = db.prepare(`
      INSERT OR IGNORE INTO tension_pairs (a_id, b_id, detected_at, resolved_at, resolution)
      VALUES (?, ?, ?, NULL, NULL)
    `);

    const txn = db.transaction(() => {
      insertEdge.run(childId, parentId, kind, ts);
      if (kind === 'contradicts') {
        const existing = checkTension.get(childId, parentId, parentId, childId);
        if (!existing) {
          insertTension.run(childId, parentId, ts);
        }
      }
    });

    txn();
  }

  // -------------------------------------------------------------------------
  // markFossilized
  // -------------------------------------------------------------------------
  function markFossilized(id, reason) {
    const db = getDbFn();
    const result = db.prepare("UPDATE assertions SET status = 'fossilized' WHERE id = ?").run(id);
    if (result.changes === 0) throw new Error(`markFossilized: assertion not found: ${id}`);
    console.error(`[ledger:fossilized] id=${id} reason=${reason}`);
  }

  // -------------------------------------------------------------------------
  // quarantine
  // -------------------------------------------------------------------------
  function quarantine(id, reason) {
    const db = getDbFn();
    const result = db.prepare("UPDATE assertions SET status = 'quarantined' WHERE id = ?").run(id);
    if (result.changes === 0) throw new Error(`quarantine: assertion not found: ${id}`);
    console.error(`[ledger:quarantined] id=${id} reason=${reason}`);
  }

  // -------------------------------------------------------------------------
  // getAssertion
  // -------------------------------------------------------------------------
  function getAssertion(id) {
    const db = getDbFn();

    const row = db.prepare('SELECT * FROM assertions WHERE id = ?').get(id);
    if (!row) return null;

    const spans = db.prepare('SELECT source_span FROM assertion_lineage WHERE assertion_id = ?')
      .all(id)
      .map(r => r.source_span);

    const supersedes = db.prepare('SELECT parent_id AS id, kind FROM supersession_edges WHERE child_id = ?')
      .all(id);

    const superseded_by = db.prepare('SELECT child_id AS id, kind FROM supersession_edges WHERE parent_id = ?')
      .all(id);

    return { ...row, source_spans: spans, supersedes, superseded_by };
  }

  // -------------------------------------------------------------------------
  // queryActiveByPlane
  // -------------------------------------------------------------------------
  function queryActiveByPlane(plane, { classes, limit = 100, since } = {}) {
    const db = getDbFn();

    const params = [plane];
    let sql = `
      SELECT a.*
      FROM assertions a
      LEFT JOIN supersession_edges se ON se.parent_id = a.id AND se.kind = 'dominates'
      WHERE a.plane = ?
        AND a.status NOT IN ('fossilized', 'quarantined')
        AND se.parent_id IS NULL
    `;

    if (Array.isArray(classes) && classes.length > 0) {
      const placeholders = classes.map(() => '?').join(', ');
      sql += ` AND a.class IN (${placeholders})`;
      params.push(...classes);
    }

    if (since !== undefined) {
      sql += ' AND a.created_at >= ?';
      params.push(since);
    }

    sql += ' ORDER BY a.created_at DESC LIMIT ?';
    params.push(limit);

    return db.prepare(sql).all(...params);
  }

  // -------------------------------------------------------------------------
  // queryByClaim
  // -------------------------------------------------------------------------
  function queryByClaim(substring, { plane, limit = 50 } = {}) {
    const db = getDbFn();

    const params = [`%${substring}%`];
    let sql = 'SELECT * FROM assertions WHERE claim LIKE ?';

    if (plane !== undefined) {
      sql += ' AND plane = ?';
      params.push(plane);
    }

    sql += ' ORDER BY confidence DESC, created_at DESC LIMIT ?';
    params.push(limit);

    return db.prepare(sql).all(...params);
  }

  // -------------------------------------------------------------------------
  // queryTensions
  // -------------------------------------------------------------------------
  function queryTensions({ resolved = false } = {}) {
    const db = getDbFn();

    const condition = resolved ? 'WHERE resolved_at IS NOT NULL' : 'WHERE resolved_at IS NULL';
    return db.prepare(`SELECT * FROM tension_pairs ${condition} ORDER BY detected_at DESC`).all();
  }

  // -------------------------------------------------------------------------
  // setCounterfactualWeight
  // -------------------------------------------------------------------------
  function setCounterfactualWeight(id, value) {
    const db = getDbFn();
    const ts = now();
    db.prepare(`
      INSERT OR REPLACE INTO counterfactual_weights (assertion_id, value, computed_at)
      VALUES (?, ?, ?)
    `).run(id, value, ts);
  }

  // -------------------------------------------------------------------------
  // stats
  // -------------------------------------------------------------------------
  function stats() {
    const db = getDbFn();

    const total = db.prepare('SELECT COUNT(*) AS n FROM assertions').get().n;

    const statusRows = db.prepare(`
      SELECT status, COUNT(*) AS n FROM assertions GROUP BY status
    `).all();
    const by_status = { tentative: 0, established: 0, fossilized: 0, quarantined: 0 };
    for (const r of statusRows) {
      if (r.status in by_status) by_status[r.status] = r.n;
    }

    const planeRows = db.prepare('SELECT plane, COUNT(*) AS n FROM assertions GROUP BY plane').all();
    const by_plane = {};
    for (const r of planeRows) {
      by_plane[r.plane] = r.n;
    }

    const tensions_open = db.prepare(
      'SELECT COUNT(*) AS n FROM tension_pairs WHERE resolved_at IS NULL'
    ).get().n;

    return { total, by_status, by_plane, tensions_open };
  }

  // -------------------------------------------------------------------------
  // ingest
  // -------------------------------------------------------------------------
  function ingest(params, { dupThreshold = 0.7, negThreshold = 0.7 } = {}) {
    const { plane, source_spans } = params;
    if (!plane) throw new Error('ingest: plane is required');

    const db = getDbFn();

    const activeClaims = db.prepare(
      `SELECT id, claim FROM assertions
       WHERE plane = ? AND status NOT IN ('fossilized','quarantined')`
    ).all(plane);

    const dup = findNearDuplicate(activeClaims, params.claim, dupThreshold);
    if (dup) {
      const spanArg = Array.isArray(source_spans) && source_spans.length > 0 ? source_spans[0] : undefined;
      reinforceAssertion(dup.id, { source_span: spanArg });
      return { action: 'reinforced', id: dup.id, similarity: dup.similarity };
    }

    const newId = createAssertion(params);

    const negationIds = findNegations(activeClaims, params.claim, negThreshold);
    for (const existingId of negationIds) {
      linkSupersession(newId, existingId, 'contradicts');
    }

    return { action: 'created', id: newId, negations: negationIds };
  }

  // -------------------------------------------------------------------------
  // markVerified
  // -------------------------------------------------------------------------
  function markVerified(id) {
    const db = getDbFn();
    const ts = now();
    const result = db.prepare(
      'UPDATE assertions SET last_verified = ? WHERE id = ?'
    ).run(ts, id);
    if (result.changes === 0) throw new Error(`markVerified: assertion not found: ${id}`);
  }

  // -------------------------------------------------------------------------
  // rankActive
  // -------------------------------------------------------------------------
  function rankActive(plane, { classes, limit = 100, since, now, context } = {}) {
    const db = getDbFn();
    const assertions = queryActiveByPlane(plane, { classes, limit, since });

    const openTensions = db.prepare(`
      SELECT a_id, b_id FROM tension_pairs WHERE resolved_at IS NULL
    `).all();
    const tensionIds = new Set();
    for (const { a_id, b_id } of openTensions) {
      tensionIds.add(a_id);
      tensionIds.add(b_id);
    }

    // Load counterfactual weights for the current assertions
    const ids = assertions.map(a => a.id);
    const counterfactualWeights = new Map();
    if (ids.length > 0) {
      const placeholders = ids.map(() => '?').join(', ');
      const rows = db.prepare(
        `SELECT assertion_id, value FROM counterfactual_weights WHERE assertion_id IN (${placeholders})`
      ).all(...ids);
      for (const { assertion_id, value } of rows) {
        counterfactualWeights.set(assertion_id, value);
      }
    }

    // Load outcome priors for the current assertions
    const outcomePriors = computeOutcomePriors(db, ids);

    return rankAssertions(assertions, {
      tensionIds,
      now: now ?? new Date(),
      context: context ?? {},
      counterfactualWeights,
      outcomePriors,
    });
  }

  // -------------------------------------------------------------------------
  // selectForContext
  // -------------------------------------------------------------------------
  function selectForContext(plane, budget, opts = {}) {
    const ranked = rankActive(plane, opts);
    const selected = _selectForContext(ranked, budget);

    if (opts.session_id) {
      const db = getDbFn();
      const ts = now();
      const insert = db.prepare(`
        INSERT INTO selection_log (id, session_id, assertion_id, selected_at, budget, score)
        VALUES (?, ?, ?, ?, ?, ?)
      `);
      const txn = db.transaction(() => {
        for (let i = 0; i < selected.length; i++) {
          const a = selected[i];
          const logId = `sl_${Date.now()}_${i}_${crypto.randomBytes(4).toString('hex')}`;
          insert.run(logId, opts.session_id, a.id, ts, budget ?? null, a.score ?? null);
        }
      });
      txn();
    }

    return selected;
  }

  return {
    createAssertion,
    reinforceAssertion,
    maybePromote,
    linkSupersession,
    markFossilized,
    quarantine,
    getAssertion,
    queryActiveByPlane,
    queryByClaim,
    queryTensions,
    setCounterfactualWeight,
    markVerified,
    stats,
    ingest,
    rankActive,
    selectForContext,
  };
}

// Production singleton: lazy DB open on first call
const ledger = createLedger(getDb);

module.exports = {
  ...ledger,
  // Test escape hatch: inject a pre-opened in-memory DB
  _createForTesting: (db) => createLedger(() => db),
};
