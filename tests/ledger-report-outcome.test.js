'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const os = require('os');
const Database = require('better-sqlite3');
const { runSqlMigrations } = require('../scripts/migrations');

function clearRequireCache(...fragments) {
  for (const frag of fragments) {
    const key = Object.keys(require.cache).find(k => k.includes(frag));
    if (key) delete require.cache[key];
  }
}

function makeTestEnv() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'engram-ro-'));
  const cacheDir = path.join(dir, '.cache');
  fs.mkdirSync(cacheDir);
  const db = new Database(path.join(cacheDir, 'engram.db'));
  db.pragma('foreign_keys = ON');
  runSqlMigrations(db);
  db.close();
  return { dir, dbPath: path.join(cacheDir, 'engram.db') };
}

// ── Validation tests (no DB needed) ──────────────────────────────────────────

test('returns error when session_id is missing', async () => {
  const { ledgerReportOutcome } = require('../scripts/mcp-tools');
  const result = await ledgerReportOutcome({ reply_text: 'hello' });
  assert.ok(result.error, 'expected an error field');
  assert.ok(result.error.includes('session_id'), `error should mention session_id, got: ${result.error}`);
});

test('returns error when reply_text is missing', async () => {
  const { ledgerReportOutcome } = require('../scripts/mcp-tools');
  const result = await ledgerReportOutcome({ session_id: 'sess:1' });
  assert.ok(result.error, 'expected an error field');
  assert.ok(result.error.includes('reply_text'), `error should mention reply_text, got: ${result.error}`);
});

test('returns error for invalid mode', async () => {
  const { ledgerReportOutcome } = require('../scripts/mcp-tools');
  const result = await ledgerReportOutcome({ session_id: 'sess:1', reply_text: 'hi', mode: 'invalid' });
  assert.ok(result.error, 'expected an error field');
  assert.ok(result.error.includes('mode'), `error should mention mode, got: ${result.error}`);
});

// ── DB-not-initialized path ───────────────────────────────────────────────────

test('returns ok with message when DB not found', async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'engram-empty-'));
  const savedPath = process.env.ENGRAM_PATH;
  process.env.ENGRAM_PATH = tmpDir;
  clearRequireCache('mcp-tools', 'capture', 'feedback/post-hoc', 'feedback/score-citations');

  try {
    const { ledgerReportOutcome } = require('../scripts/mcp-tools');
    const result = await ledgerReportOutcome({ session_id: 'sess:1', reply_text: 'hello' });
    assert.equal(result.ok, true);
    assert.ok(result.message, 'expected message field');
  } finally {
    process.env.ENGRAM_PATH = savedPath;
    clearRequireCache('mcp-tools', 'capture', 'feedback/post-hoc', 'feedback/score-citations');
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

// ── Smoke tests with real temp DB ─────────────────────────────────────────────

function seedSession(dbPath, sessionId) {
  const db = new Database(dbPath);
  const { _createForTesting } = require('../scripts/ledger');
  const ledger = _createForTesting(db);
  const aid = ledger.createAssertion({
    plane: 'user:x',
    class_: 'monotonic',
    claim: 'the sky is blue',
    source_spans: ['s:1'],
    confidence: 0.9,
  });
  const ts = new Date().toISOString();
  db.prepare(
    'INSERT INTO selection_log (id, session_id, assertion_id, selected_at, budget) VALUES (?,?,?,?,?)'
  ).run('sl1', sessionId, aid, ts, 1000);
  db.close();
  return aid;
}

test('post_hoc mode scores a session', async () => {
  const { dir, dbPath } = makeTestEnv();
  const sessionId = 'sess:ph1';
  seedSession(dbPath, sessionId);

  const savedPath = process.env.ENGRAM_PATH;
  process.env.ENGRAM_PATH = dir;
  clearRequireCache('mcp-tools', 'capture', 'feedback/post-hoc', 'feedback/score-citations');

  try {
    const { ledgerReportOutcome } = require('../scripts/mcp-tools');
    const result = await ledgerReportOutcome({
      session_id: sessionId,
      reply_text: 'the sky is blue today',
      mode: 'post_hoc',
    });
    assert.equal(result.ok, true);
    assert.ok(result.post_hoc, 'expected post_hoc result');
    assert.equal(typeof result.post_hoc.scored, 'number');
    assert.equal(result.citation, null);
  } finally {
    process.env.ENGRAM_PATH = savedPath;
    clearRequireCache('mcp-tools', 'capture', 'feedback/post-hoc', 'feedback/score-citations');
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('citation mode scores a session', async () => {
  const { dir, dbPath } = makeTestEnv();
  const sessionId = 'sess:cit1';
  const aid = seedSession(dbPath, sessionId);

  const savedPath = process.env.ENGRAM_PATH;
  process.env.ENGRAM_PATH = dir;
  clearRequireCache('mcp-tools', 'capture', 'feedback/post-hoc', 'feedback/score-citations');

  try {
    const { ledgerReportOutcome } = require('../scripts/mcp-tools');
    const result = await ledgerReportOutcome({
      session_id: sessionId,
      reply_text: `The sky is blue [[A:${aid}]] as always.`,
      mode: 'citation',
    });
    assert.equal(result.ok, true);
    assert.equal(result.post_hoc, null);
    assert.ok(result.citation, 'expected citation result');
    assert.equal(typeof result.citation.scored, 'number');
  } finally {
    process.env.ENGRAM_PATH = savedPath;
    clearRequireCache('mcp-tools', 'capture', 'feedback/post-hoc', 'feedback/score-citations');
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('both mode runs both scorers', async () => {
  const { dir, dbPath } = makeTestEnv();
  const sessionId = 'sess:both1';
  const aid = seedSession(dbPath, sessionId);

  const savedPath = process.env.ENGRAM_PATH;
  process.env.ENGRAM_PATH = dir;
  clearRequireCache('mcp-tools', 'capture', 'feedback/post-hoc', 'feedback/score-citations');

  try {
    const { ledgerReportOutcome } = require('../scripts/mcp-tools');
    const result = await ledgerReportOutcome({
      session_id: sessionId,
      reply_text: `The sky is blue [[A:${aid}]] today.`,
      mode: 'both',
    });
    assert.equal(result.ok, true);
    assert.ok(result.post_hoc, 'expected post_hoc result');
    assert.ok(result.citation, 'expected citation result');
    assert.equal(typeof result.post_hoc.scored, 'number');
    assert.equal(typeof result.citation.scored, 'number');
  } finally {
    process.env.ENGRAM_PATH = savedPath;
    clearRequireCache('mcp-tools', 'capture', 'feedback/post-hoc', 'feedback/score-citations');
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
