#!/usr/bin/env node

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const Database = require('better-sqlite3');
const { runSqlMigrations } = require('../scripts/migrations');
const { _createForTesting } = require('../scripts/ledger');

function makeTestLedger() {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  runSqlMigrations(db);
  return { ledger: _createForTesting(db), db };
}

describe('Feedback loop migration (0002)', () => {
  it('applies and creates selection_log + assertion_outcomes', () => {
    const db = new Database(':memory:');
    const result = runSqlMigrations(db);
    assert.ok(result.applied.includes('0002_feedback_loop.sql'));

    const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table'")
      .all().map(r => r.name);
    assert.ok(tables.includes('selection_log'));
    assert.ok(tables.includes('assertion_outcomes'));
    db.close();
  });

  it('creates expected indexes', () => {
    const db = new Database(':memory:');
    runSqlMigrations(db);
    const indexes = db.prepare("SELECT name FROM sqlite_master WHERE type='index'")
      .all().map(r => r.name);
    assert.ok(indexes.includes('idx_selection_log_session'));
    assert.ok(indexes.includes('idx_selection_log_assertion'));
    assert.ok(indexes.includes('idx_outcomes_assertion'));
    assert.ok(indexes.includes('idx_outcomes_session'));
    assert.ok(indexes.includes('idx_outcomes_source'));
    db.close();
  });

  it('is idempotent — second run applies nothing new', () => {
    const db = new Database(':memory:');
    runSqlMigrations(db);
    const r2 = runSqlMigrations(db);
    assert.equal(r2.applied.length, 0);
    assert.ok(r2.skipped.includes('0002_feedback_loop.sql'));
    db.close();
  });

  it('rejects invalid signal_source via CHECK constraint', () => {
    const { ledger, db } = makeTestLedger();
    const aid = ledger.createAssertion({
      plane: 'user:x', class_: 'monotonic', claim: 'c',
      source_spans: ['s:1'],
    });
    assert.throws(() => {
      db.prepare(`
        INSERT INTO assertion_outcomes
          (id, assertion_id, session_id, selected_at, signal_source, score)
        VALUES (?, ?, ?, ?, ?, ?)
      `).run('o_1', aid, 'sess:1', new Date().toISOString(), 'bogus', 0.5);
    }, /CHECK constraint failed/);
  });

  it('rejects score outside [0, 1] via CHECK constraint', () => {
    const { ledger, db } = makeTestLedger();
    const aid = ledger.createAssertion({
      plane: 'user:x', class_: 'monotonic', claim: 'c',
      source_spans: ['s:1'],
    });
    assert.throws(() => {
      db.prepare(`
        INSERT INTO assertion_outcomes
          (id, assertion_id, session_id, selected_at, signal_source, score)
        VALUES (?, ?, ?, ?, ?, ?)
      `).run('o_2', aid, 'sess:1', new Date().toISOString(), 'post_hoc', 1.5);
    }, /CHECK constraint failed/);
  });

  it('declares ON DELETE CASCADE for assertion_id FKs on both new tables', () => {
    const db = new Database(':memory:');
    runSqlMigrations(db);

    const selFks = db.prepare("SELECT * FROM pragma_foreign_key_list('selection_log')").all();
    const selAssertFk = selFks.find(r => r.table === 'assertions' && r.from === 'assertion_id');
    assert.ok(selAssertFk, 'selection_log must have FK to assertions');
    assert.equal(selAssertFk.on_delete, 'CASCADE');

    const outFks = db.prepare("SELECT * FROM pragma_foreign_key_list('assertion_outcomes')").all();
    const outAssertFk = outFks.find(r => r.table === 'assertions' && r.from === 'assertion_id');
    assert.ok(outAssertFk, 'assertion_outcomes must have FK to assertions');
    assert.equal(outAssertFk.on_delete, 'CASCADE');

    db.close();
  });
});

describe('selectForContext logging', () => {
  function seed(ledger, count) {
    const ids = [];
    for (let i = 0; i < count; i++) {
      ids.push(ledger.createAssertion({
        plane: 'user:x',
        class_: 'monotonic',
        claim: `claim number ${i}`,
        source_spans: [`s:${i}`],
        confidence: 0.8,
      }));
    }
    return ids;
  }

  it('writes one selection_log row per selected assertion when session_id is given', () => {
    const { ledger, db } = makeTestLedger();
    seed(ledger, 3);

    const picks = ledger.selectForContext('user:x', 1000, { session_id: 'sess:42' });
    assert.ok(picks.length >= 1);

    const rows = db.prepare('SELECT * FROM selection_log WHERE session_id = ?').all('sess:42');
    assert.equal(rows.length, picks.length);
    for (const row of rows) {
      assert.equal(row.session_id, 'sess:42');
      assert.ok(picks.some(p => p.id === row.assertion_id));
      assert.equal(row.budget, 1000);
      assert.ok(typeof row.selected_at === 'string' && row.selected_at.length > 0);
    }
  });

  it('writes zero rows when session_id is omitted (no behavior change for legacy callers)', () => {
    const { ledger, db } = makeTestLedger();
    seed(ledger, 3);

    ledger.selectForContext('user:x', 1000);

    const count = db.prepare('SELECT COUNT(*) AS n FROM selection_log').get().n;
    assert.equal(count, 0);
  });

  it('produces unique log ids across a single selection batch', () => {
    const { ledger, db } = makeTestLedger();
    seed(ledger, 5);

    ledger.selectForContext('user:x', 10_000, { session_id: 'sess:unique' });

    const rows = db.prepare('SELECT id FROM selection_log WHERE session_id = ?').all('sess:unique');
    const ids = new Set(rows.map(r => r.id));
    assert.equal(ids.size, rows.length, 'every log id must be unique');
  });
});
