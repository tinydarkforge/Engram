#!/usr/bin/env node

const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const os = require('os');

describe('LazyLoader', () => {
  let tmpDir;
  let LazyLoader;

  before(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'codicil-lazy-'));
    process.env.CODICIL_SILENT = '1';

    // Create Codicil structure with sessions
    const projDir = path.join(tmpDir, 'summaries', 'projects', 'TestProject');
    fs.mkdirSync(projDir, { recursive: true });

    const sessionsIndex = {
      project: 'TestProject',
      total_sessions: 2,
      sessions: [
        {
          id: 'session-001',
          project: 'TestProject',
          date: '2025-12-01',
          summary: 'Added authentication',
          topics: ['auth', 'security'],
          key_decisions: ['Use JWT'],
          outcomes: ['Login flow complete'],
          learnings: ['Token expiry matters'],
          code_changes: { files: 5, additions: 200, deletions: 50 },
        },
        {
          id: 'session-002',
          project: 'TestProject',
          date: '2025-12-02',
          summary: 'Fixed caching bug',
          topics: ['cache', 'performance'],
          key_decisions: ['Switch to LRU'],
          outcomes: ['Cache hit rate improved'],
          learnings: ['TTL must be configurable'],
          code_changes: { files: 3, additions: 100, deletions: 30 },
        },
      ],
    };

    fs.writeFileSync(
      path.join(projDir, 'sessions-index.json'),
      JSON.stringify(sessionsIndex, null, 2)
    );

    process.env.CODICIL_PATH = tmpDir;

    // Clear module cache
    Object.keys(require.cache)
      .filter(k => k.includes('lazy-loader') || k.includes('paths') || k.includes('safe-json'))
      .forEach(k => delete require.cache[k]);

    LazyLoader = require('../scripts/lazy-loader');
  });

  after(() => {
    delete process.env.CODICIL_PATH;
    delete process.env.CODICIL_SILENT;
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  describe('convertToLazyFormat()', () => {
    it('creates lightweight index and detail files', async () => {
      const loader = new LazyLoader();
      const result = await loader.convertToLazyFormat();

      assert.equal(result.total_sessions, 2);
      assert.ok(result.size_before_kb >= 0);
      assert.ok(result.size_after_kb >= 0);

      // Check detail files were created
      const sessionsDir = path.join(tmpDir, 'summaries', 'projects', 'TestProject', 'sessions');
      assert.ok(fs.existsSync(sessionsDir));
      assert.ok(fs.existsSync(path.join(sessionsDir, 'session-001.json')));
      assert.ok(fs.existsSync(path.join(sessionsDir, 'session-002.json')));
    });

    it('lightweight index has only essential fields', async () => {
      const indexPath = path.join(
        tmpDir, 'summaries', 'projects', 'TestProject', 'sessions-index.json'
      );
      const index = JSON.parse(fs.readFileSync(indexPath, 'utf8'));

      assert.equal(index._lazy_loading_enabled, true);
      assert.equal(index.sessions.length, 2);

      // Lightweight session should NOT have heavy fields
      const session = index.sessions[0];
      assert.ok(session.id);
      assert.ok(session.date);
      assert.ok(session.summary);
      assert.ok(Array.isArray(session.topics));
      assert.equal(session.key_decisions, undefined);
      assert.equal(session.outcomes, undefined);
      assert.equal(session.code_changes, undefined);
    });

    it('detail files have full data plus metadata', () => {
      const detailPath = path.join(
        tmpDir, 'summaries', 'projects', 'TestProject', 'sessions', 'session-001.json'
      );
      const detail = JSON.parse(fs.readFileSync(detailPath, 'utf8'));

      assert.equal(detail.id, 'session-001');
      assert.deepEqual(detail.key_decisions, ['Use JWT']);
      assert.deepEqual(detail.outcomes, ['Login flow complete']);
      assert.equal(detail._lazy_loaded, true);
      assert.equal(typeof detail._index_size_bytes, 'number');
      assert.equal(typeof detail._full_size_bytes, 'number');
    });
  });

  describe('loadSessionDetails()', () => {
    it('loads session details from file', () => {
      const loader = new LazyLoader();
      const details = loader.loadSessionDetails('TestProject', 'session-001');

      assert.ok(details);
      assert.equal(details.id, 'session-001');
      assert.deepEqual(details.key_decisions, ['Use JWT']);
    });

    it('returns null for nonexistent session', () => {
      const loader = new LazyLoader();
      const details = loader.loadSessionDetails('TestProject', 'nonexistent');
      assert.equal(details, null);
    });

    it('returns null for nonexistent project', () => {
      const loader = new LazyLoader();
      const details = loader.loadSessionDetails('FakeProject', 'session-001');
      assert.equal(details, null);
    });
  });

  describe('revertToFullFormat()', () => {
    it('restores full sessions in index', async () => {
      const loader = new LazyLoader();
      await loader.revertToFullFormat();

      const indexPath = path.join(
        tmpDir, 'summaries', 'projects', 'TestProject', 'sessions-index.json'
      );
      const index = JSON.parse(fs.readFileSync(indexPath, 'utf8'));

      assert.equal(index._lazy_loading_enabled, undefined);
      assert.equal(index.sessions.length, 2);

      // Should have full data restored
      const session = index.sessions[0];
      assert.ok(session.id);
      assert.ok(session.key_decisions);
      assert.ok(session.outcomes);

      // Metadata fields should be removed
      assert.equal(session._lazy_loaded, undefined);
      assert.equal(session._index_size_bytes, undefined);
    });
  });

  describe('convertToLazyFormat() then revert round-trip', () => {
    it('preserves session data through convert/revert cycle', async () => {
      // Re-convert to lazy format for this test
      const loader = new LazyLoader();
      await loader.convertToLazyFormat();
      await loader.revertToFullFormat();

      const indexPath = path.join(
        tmpDir, 'summaries', 'projects', 'TestProject', 'sessions-index.json'
      );
      const index = JSON.parse(fs.readFileSync(indexPath, 'utf8'));

      assert.equal(index.sessions[0].summary, 'Added authentication');
      assert.equal(index.sessions[1].summary, 'Fixed caching bug');
      assert.deepEqual(index.sessions[0].topics, ['auth', 'security']);
    });
  });
});
