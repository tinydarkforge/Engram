#!/usr/bin/env node

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const Database = require('better-sqlite3');
const { runSqlMigrations } = require('../scripts/migrations');
const { _createForTesting } = require('../scripts/ledger');
const { scoreSession, cosineSimilarity } = require('../scripts/feedback/post-hoc');

// Word-frequency bag-of-words vector — produces cosine similarity that reflects
// actual word overlap, letting us assert which assertion "matches" the reply.
function bowVector(text, vocab) {
  const words = text.toLowerCase().replace(/[^a-z0-9 ]/g, '').split(/\s+/);
  return vocab.map(w => words.filter(x => x === w).length);
}

function makeBowEmbedFn(vocab) {
  return async (text) => bowVector(text, vocab);
}

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

  // Write selection_log rows directly (simulates ledger.selectForContext with session_id)
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

// Vocab covering both assertions and the test replies
const VOCAB = ['sky', 'blue', 'clear', 'cats', 'eat', 'fish', 'every', 'day', 'beautiful'];

describe('cosineSimilarity', () => {
  it('identical vectors → 1.0', () => {
    const v = [1, 0, 1, 0];
    assert.ok(Math.abs(cosineSimilarity(v, v) - 1.0) < 1e-9);
  });

  it('orthogonal vectors → 0.0', () => {
    assert.equal(cosineSimilarity([1, 0], [0, 1]), 0);
  });

  it('zero vector → 0.0', () => {
    assert.equal(cosineSimilarity([0, 0], [1, 1]), 0);
  });

  it('mismatched lengths → 0.0', () => {
    assert.equal(cosineSimilarity([1, 2], [1, 2, 3]), 0);
  });
});

describe('scoreSession', () => {
  it('writes one outcome row per selected assertion', async () => {
    const db = makeTestDb();
    const ledger = makeTestLedger(db);
    const { id1, id2 } = seedAndSelect(db, ledger, 'sess:smoke');

    const result = await scoreSession({
      sessionId: 'sess:smoke',
      replyText: 'the sky is very blue today',
      db,
      embedFn: makeBowEmbedFn(VOCAB),
    });

    assert.equal(result.scored, 2);
    assert.equal(result.skipped, 0);

    const rows = db.prepare(`SELECT * FROM assertion_outcomes WHERE session_id = ?`).all('sess:smoke');
    assert.equal(rows.length, 2);
    for (const row of rows) {
      assert.equal(row.signal_source, 'post_hoc');
      assert.ok(row.score >= 0 && row.score <= 1);
      assert.ok(row.reply_hash.length > 0);
    }
  });

  it('sky-reply scores sky assertion higher than cats assertion', async () => {
    const db = makeTestDb();
    const ledger = makeTestLedger(db);
    const { id1, id2 } = seedAndSelect(db, ledger, 'sess:rank');

    await scoreSession({
      sessionId: 'sess:rank',
      replyText: 'yes the sky is blue and beautiful today',
      db,
      embedFn: makeBowEmbedFn(VOCAB),
    });

    const rows = db.prepare(`SELECT assertion_id, score FROM assertion_outcomes WHERE session_id = ?`)
      .all('sess:rank');
    const skyRow  = rows.find(r => r.assertion_id === id1);
    const catsRow = rows.find(r => r.assertion_id === id2);

    assert.ok(skyRow,  'sky assertion should have an outcome row');
    assert.ok(catsRow, 'cats assertion should have an outcome row');
    assert.ok(skyRow.score > catsRow.score,
      `sky score (${skyRow.score}) should exceed cats score (${catsRow.score})`);
  });

  it('is idempotent — second scoreSession does not add duplicate rows', async () => {
    const db = makeTestDb();
    const ledger = makeTestLedger(db);
    seedAndSelect(db, ledger, 'sess:idem');

    const r1 = await scoreSession({ sessionId: 'sess:idem', replyText: 'hello sky', db, embedFn: makeBowEmbedFn(VOCAB) });
    const r2 = await scoreSession({ sessionId: 'sess:idem', replyText: 'hello sky', db, embedFn: makeBowEmbedFn(VOCAB) });

    assert.equal(r1.scored, 2);
    assert.equal(r2.scored, 0);  // INSERT OR IGNORE — same reply_hash already present
    assert.equal(r2.skipped, 2);

    const count = db.prepare(`SELECT COUNT(*) AS n FROM assertion_outcomes WHERE session_id = ?`).get('sess:idem').n;
    assert.equal(count, 2);
  });

  it('returns { scored: 0, skipped: 0 } when session has no selection_log rows', async () => {
    const db = makeTestDb();
    const result = await scoreSession({
      sessionId: 'sess:empty',
      replyText: 'whatever',
      db,
      embedFn: makeBowEmbedFn(VOCAB),
    });
    assert.deepEqual(result, { scored: 0, skipped: 0 });
  });

  it('clamps negative cosine scores to 0', async () => {
    const db = makeTestDb();
    const ledger = makeTestLedger(db);

    const aid = ledger.createAssertion({
      plane: 'user:x', class_: 'monotonic',
      claim: 'some claim',
      source_spans: ['s:1'],
    });
    const ts = new Date().toISOString();
    db.prepare(`INSERT INTO selection_log (id, session_id, assertion_id, selected_at) VALUES (?,?,?,?)`)
      .run('sl_neg', 'sess:neg', aid, ts);

    // embedFn that returns opposing vectors
    const embedFn = async (text) => text.includes('some') ? [1, 0] : [-1, 0];

    await scoreSession({ sessionId: 'sess:neg', replyText: 'reply', db, embedFn });

    const row = db.prepare(`SELECT score FROM assertion_outcomes WHERE session_id = ?`).get('sess:neg');
    assert.ok(row.score >= 0, 'score should be clamped to 0 when cosine is negative');
  });

  it('throws when required params are missing', async () => {
    const db = makeTestDb();
    await assert.rejects(() => scoreSession({ replyText: 'x', db, embedFn: async () => [] }),
      /sessionId is required/);
    await assert.rejects(() => scoreSession({ sessionId: 's', db, embedFn: async () => [] }),
      /replyText must be a string/);
    await assert.rejects(() => scoreSession({ sessionId: 's', replyText: 'x', embedFn: async () => [] }),
      /db is required/);
    await assert.rejects(() => scoreSession({ sessionId: 's', replyText: 'x', db }),
      /embedFn is required/);
  });
});
