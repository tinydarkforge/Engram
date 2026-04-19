#!/usr/bin/env node
'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const Database = require('better-sqlite3');
const { runSqlMigrations } = require('../scripts/migrations');
const { _createForTesting } = require('../scripts/ledger');
const { parseCitations } = require('../scripts/feedback/citation');
const { scoreCitations } = require('../scripts/feedback/score-citations');
const { renderAssertion } = require('../scripts/render');

function makeTestDb() {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  runSqlMigrations(db);
  return db;
}

function makeTestLedger(db) {
  return _createForTesting(db);
}

function seedAndSelect(db, ledger, sessionId) {
  const id1 = ledger.createAssertion({
    plane: 'user:x', class_: 'monotonic',
    claim: 'the sky is blue and clear',
    source_spans: ['s:1'], confidence: 0.9,
  });
  const id2 = ledger.createAssertion({
    plane: 'user:x', class_: 'monotonic',
    claim: 'cats eat fish every day',
    source_spans: ['s:2'], confidence: 0.9,
  });

  const ts = new Date().toISOString();
  db.prepare(`
    INSERT INTO selection_log (id, session_id, assertion_id, selected_at, budget)
    VALUES (?, ?, ?, ?, ?)
  `).run(`sl_1_${sessionId}`, sessionId, id1, ts, 1000);
  db.prepare(`
    INSERT INTO selection_log (id, session_id, assertion_id, selected_at, budget)
    VALUES (?, ?, ?, ?, ?)
  `).run(`sl_2_${sessionId}`, sessionId, id2, ts, 1000);

  return { id1, id2 };
}

// --- parseCitations ---

describe('parseCitations', () => {
  it('returns [] for empty string', () => {
    assert.deepEqual(parseCitations(''), []);
  });

  it('returns [] for non-string input — null', () => {
    assert.deepEqual(parseCitations(null), []);
  });

  it('returns [] for non-string input — undefined', () => {
    assert.deepEqual(parseCitations(undefined), []);
  });

  it('returns [] for non-string input — number', () => {
    assert.deepEqual(parseCitations(42), []);
  });

  it('finds [[A:id1]] tags', () => {
    const result = parseCitations('hello [[A:a_123_abcd]] world');
    assert.deepEqual(result, ['a_123_abcd']);
  });

  it('finds multiple [[A:...]] tags', () => {
    const result = parseCitations('[[A:id1]] and [[A:id2]]');
    assert.deepEqual(result, ['id1', 'id2']);
  });

  it('finds Claude <cite id="..." /> tags', () => {
    const result = parseCitations('see <cite id="a_999_cafe" /> here');
    assert.deepEqual(result, ['a_999_cafe']);
  });

  it('finds <cite id="..."></cite> tags', () => {
    const result = parseCitations('ref <cite id="a_111_beef">text</cite>');
    assert.deepEqual(result, ['a_111_beef']);
  });

  it('deduplicates repeated IDs', () => {
    const result = parseCitations('[[A:dup]] and [[A:dup]]');
    assert.deepEqual(result, ['dup']);
  });

  it('handles mixed format — both [[A:...]] and <cite> in same reply', () => {
    const result = parseCitations('[[A:id1]] plus <cite id="id2" /> and <cite id="id1"></cite>');
    assert.ok(result.includes('id1'));
    assert.ok(result.includes('id2'));
    assert.equal(result.length, 2);
  });
});

// --- renderAssertion with citation option ---

describe('renderAssertion with citation option', () => {
  it('appends [[A:<id>]] when opts.citation is true', () => {
    const assertion = {
      id: 'a_9999_test',
      claim: 'the sky is blue',
      class: 'monotonic',
      density_hint: 'terse',
      confidence: 0.9,
      quorum_count: 1,
    };
    const text = renderAssertion(assertion, { citation: true });
    assert.ok(text.endsWith(' [[A:a_9999_test]]'), `got: ${text}`);
  });

  it('does not append suffix when opts.citation is false/absent', () => {
    const assertion = {
      id: 'a_9999_test',
      claim: 'the sky is blue',
      class: 'monotonic',
      density_hint: 'terse',
      confidence: 0.9,
    };
    const text = renderAssertion(assertion);
    assert.ok(!text.includes('[[A:'), `unexpected citation tag: ${text}`);
  });

  it('does not append suffix when assertion has no id', () => {
    const assertion = {
      claim: 'the sky is blue',
      class: 'monotonic',
      density_hint: 'terse',
      confidence: 0.9,
    };
    const text = renderAssertion(assertion, { citation: true });
    assert.ok(!text.includes('[[A:'), `unexpected citation tag: ${text}`);
  });
});

// --- scoreCitations ---

describe('scoreCitations', () => {
  it('writes outcome rows for cited assertions found in selection_log', () => {
    const db = makeTestDb();
    const ledger = makeTestLedger(db);
    const { id1, id2 } = seedAndSelect(db, ledger, 'sess:cite-smoke');

    const result = scoreCitations({
      sessionId: 'sess:cite-smoke',
      replyText: `here [[A:${id1}]] and [[A:${id2}]]`,
      db,
    });

    assert.equal(result.scored, 2);
    assert.equal(result.skipped, 0);

    const rows = db.prepare(`SELECT * FROM assertion_outcomes WHERE session_id = ?`).all('sess:cite-smoke');
    assert.equal(rows.length, 2);
    for (const row of rows) {
      assert.equal(row.signal_source, 'citation');
      assert.equal(row.score, 1.0);
      assert.ok(row.reply_hash.length > 0);
    }
  });

  it('ignores cited IDs not in selection_log for this session', () => {
    const db = makeTestDb();
    const ledger = makeTestLedger(db);
    const { id1 } = seedAndSelect(db, ledger, 'sess:cite-filter');

    const result = scoreCitations({
      sessionId: 'sess:cite-filter',
      replyText: `[[A:${id1}]] [[A:a_notreal_0000]]`,
      db,
    });

    assert.equal(result.scored, 1);
    assert.equal(result.skipped, 0);
  });

  it('is idempotent — second call with same reply returns skipped=N', () => {
    const db = makeTestDb();
    const ledger = makeTestLedger(db);
    const { id1 } = seedAndSelect(db, ledger, 'sess:cite-idem');

    const reply = `[[A:${id1}]]`;
    const r1 = scoreCitations({ sessionId: 'sess:cite-idem', replyText: reply, db });
    const r2 = scoreCitations({ sessionId: 'sess:cite-idem', replyText: reply, db });

    assert.equal(r1.scored, 1);
    assert.equal(r2.scored, 0);
    assert.equal(r2.skipped, 1);

    const count = db.prepare(`SELECT COUNT(*) AS n FROM assertion_outcomes WHERE session_id = ?`).get('sess:cite-idem').n;
    assert.equal(count, 1);
  });

  it('returns { scored: 0, skipped: 0 } when reply has no citations', () => {
    const db = makeTestDb();
    const ledger = makeTestLedger(db);
    seedAndSelect(db, ledger, 'sess:cite-empty');

    const result = scoreCitations({
      sessionId: 'sess:cite-empty',
      replyText: 'no citations here at all',
      db,
    });

    assert.deepEqual(result, { scored: 0, skipped: 0 });
  });

  it('throws on missing sessionId', () => {
    const db = makeTestDb();
    assert.throws(() => scoreCitations({ replyText: 'x', db }), /sessionId is required/);
  });

  it('throws on non-string replyText', () => {
    const db = makeTestDb();
    assert.throws(() => scoreCitations({ sessionId: 's', replyText: null, db }), /replyText must be a string/);
  });

  it('throws on missing db', () => {
    assert.throws(() => scoreCitations({ sessionId: 's', replyText: 'x' }), /db is required/);
  });
});
