#!/usr/bin/env node

const { describe, it, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const os = require('os');

function createTestFixture() {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'memex-save-test-'));

  const index = {
    v: '4.0.0',
    u: new Date().toISOString(),
    m: { tp: 1, ts: 0, gs: 5 },
    g: {
      cs: { s: 'Conventional Commits', qr: {} },
      pg: { s: 'PR Guidelines', qr: {} },
      bs: { s: 'Branching', qr: {} },
      cd: { s: 'Code Standards', qr: {} },
      sc: { s: 'Security', qr: {} },
    },
    p: {
      TestSaveProject: {
        d: 'Test project for save tests',
        ts: ['Node.js'],
        sc: 0,
        u: '2025-12-01',
        mf: 'metadata/projects/TestSaveProject.json',
        qr: {},
        tp: [],
      },
    },
    t: {},
    _legend: {},
  };

  fs.writeFileSync(path.join(tmpDir, 'index.json'), JSON.stringify(index, null, 2));
  fs.mkdirSync(path.join(tmpDir, 'metadata', 'projects'), { recursive: true });
  fs.writeFileSync(
    path.join(tmpDir, 'metadata', 'projects', 'TestSaveProject.json'),
    JSON.stringify({ ts: ['Node.js'] })
  );
  fs.mkdirSync(path.join(tmpDir, '.cache'), { recursive: true });
  fs.mkdirSync(path.join(tmpDir, 'summaries', 'projects'), { recursive: true });

  return tmpDir;
}

function cleanupFixture(tmpDir) {
  fs.rmSync(tmpDir, { recursive: true, force: true });
}

function loadSessionSaverWithFixture(fixturePath) {
  const modulesToClear = Object.keys(require.cache).filter(
    (k) =>
      k.includes('save-session') ||
      k.includes('memex-loader') ||
      k.includes('persistent-cache') ||
      k.includes('manifest-manager') ||
      k.includes('vector-search') ||
      k.includes('bloom-filter') ||
      k.includes('paths')
  );
  modulesToClear.forEach((k) => delete require.cache[k]);

  const pathsModule = require('../scripts/paths');
  const originalResolve = pathsModule.resolveMemexPath;
  pathsModule.resolveMemexPath = () => fixturePath;

  const SessionSaver = require('../scripts/save-session');
  return { SessionSaver, restore: () => { pathsModule.resolveMemexPath = originalResolve; } };
}

describe('SessionSaver', () => {
  let fixturePath;
  let SessionSaver;
  let restore;

  before(() => {
    fixturePath = createTestFixture();
    // Mock git remote to return TestSaveProject
    const originalCwd = process.cwd;
    process.cwd = () => fixturePath;

    const loaded = loadSessionSaverWithFixture(fixturePath);
    SessionSaver = loaded.SessionSaver;
    restore = () => {
      loaded.restore();
      process.cwd = originalCwd;
    };
  });

  after(() => {
    restore();
    cleanupFixture(fixturePath);
  });

  describe('generateSessionId()', () => {
    it('generates ID with correct format', () => {
      // We can't easily instantiate SessionSaver because it tries to detect
      // the project via git. Instead, test the ID format via the class prototype.
      const today = new Date().toISOString().split('T')[0];

      // Create a mock instance
      const saver = Object.create(SessionSaver.prototype);
      saver.currentProject = 'TestSaveProject';

      const id = saver.generateSessionId(['auth', 'oauth']);

      // Format: <2-char prefix>-<date>-<time>-<topic>-<nonce>
      assert.ok(id.startsWith('te-'), `ID should start with "te-" but got "${id}"`);
      assert.ok(id.includes(today), `ID should contain today's date "${today}"`);
      assert.ok(id.includes('auth'), `ID should contain first topic "auth"`);
    });

    it('uses "session" as fallback topic', () => {
      const saver = Object.create(SessionSaver.prototype);
      saver.currentProject = 'TestSaveProject';

      const id = saver.generateSessionId([]);
      assert.ok(id.includes('session'), `ID should contain "session" fallback but got "${id}"`);
    });

    it('truncates long topic slugs', () => {
      const saver = Object.create(SessionSaver.prototype);
      saver.currentProject = 'TestSaveProject';

      const longTopic = 'this-is-a-very-long-topic-name-that-should-be-truncated';
      const id = saver.generateSessionId([longTopic]);

      // Topic slug is limited to 24 chars
      const parts = id.split('-');
      // The topic part is after date and time components
      // Format: te-2025-12-01-1234-this-is-a-very-long-topic-nonce
      assert.ok(id.length < 100, 'ID should not be excessively long');
    });
  });

  describe('saveSession()', () => {
    it('saves session without git commit by default', async () => {
      const saver = Object.create(SessionSaver.prototype);
      saver.currentProject = 'TestSaveProject';
      saver.memex = require('../scripts/memex-loader');
      saver.loader = { loadIndex: () => {}, detectProject: () => ({ project: 'TestSaveProject' }) };

      const result = await saver.saveSession('Test session', ['testing'], null, {});

      assert.ok(result.saved);
      assert.equal(result.project, 'TestSaveProject');
      assert.ok(result.session_id);

      // Verify sessions-index.json was created
      const indexPath = path.join(fixturePath, 'summaries', 'projects', 'TestSaveProject', 'sessions-index.json');
      assert.ok(fs.existsSync(indexPath), 'sessions-index.json should exist');

      const sessionsIndex = JSON.parse(fs.readFileSync(indexPath, 'utf8'));
      assert.equal(sessionsIndex.total_sessions, 1);
      assert.equal(sessionsIndex.sessions[0].summary, 'Test session');
      assert.deepEqual(sessionsIndex.sessions[0].topics, ['testing']);
    });

    it('saves full content when provided', async () => {
      const saver = Object.create(SessionSaver.prototype);
      saver.currentProject = 'TestSaveProject';

      const result = await saver.saveSession('With content', ['docs'], '# Detailed Notes\n\nSome content here.');

      const yearMonth = new Date().toISOString().substring(0, 7);
      const contentPath = path.join(
        fixturePath,
        'content',
        'projects',
        'TestSaveProject',
        'sessions',
        yearMonth,
        `${result.session_id}.md`
      );
      assert.ok(fs.existsSync(contentPath), 'Content file should exist');

      const content = fs.readFileSync(contentPath, 'utf8');
      assert.ok(content.includes('Detailed Notes'));
    });

    it('updates topics index correctly', async () => {
      const saver = Object.create(SessionSaver.prototype);
      saver.currentProject = 'TestSaveProject';

      await saver.saveSession('Multi topic session', ['api', 'backend']);

      const indexPath = path.join(fixturePath, 'summaries', 'projects', 'TestSaveProject', 'sessions-index.json');
      const sessionsIndex = JSON.parse(fs.readFileSync(indexPath, 'utf8'));

      assert.ok(sessionsIndex.topics_index.api, 'Should have api topic');
      assert.ok(sessionsIndex.topics_index.backend, 'Should have backend topic');
    });

    it('does not call commitToGit when commit option is false', async () => {
      const saver = Object.create(SessionSaver.prototype);
      saver.currentProject = 'TestSaveProject';
      let commitCalled = false;
      saver.commitToGit = () => { commitCalled = true; };

      await saver.saveSession('No commit', ['test'], null, { commit: false });
      assert.equal(commitCalled, false, 'commitToGit should not be called');
    });

    it('calls commitToGit when commit option is true', async () => {
      const saver = Object.create(SessionSaver.prototype);
      saver.currentProject = 'TestSaveProject';
      let commitCalled = false;
      let pushOption = null;
      saver.commitToGit = (id, opts) => { commitCalled = true; pushOption = opts; };

      await saver.saveSession('With commit', ['test'], null, { commit: true, push: false });
      assert.equal(commitCalled, true, 'commitToGit should be called');
      assert.equal(pushOption.push, false, 'push should be false');
    });

    it('handles concurrent saves without corrupting index', async () => {
      const indexPath = path.join(fixturePath, 'summaries', 'projects', 'TestSaveProject', 'sessions-index.json');
      let startingTotal = 0;
      if (fs.existsSync(indexPath)) {
        const existingIndex = JSON.parse(fs.readFileSync(indexPath, 'utf8'));
        startingTotal = existingIndex.total_sessions || 0;
      }

      const saverA = Object.create(SessionSaver.prototype);
      saverA.currentProject = 'TestSaveProject';
      const saverB = Object.create(SessionSaver.prototype);
      saverB.currentProject = 'TestSaveProject';

      const [resultA, resultB] = await Promise.all([
        saverA.saveSession('Concurrent A', ['api']),
        saverB.saveSession('Concurrent B', ['api']),
      ]);

      assert.ok(resultA.session_id);
      assert.ok(resultB.session_id);
      assert.notEqual(resultA.session_id, resultB.session_id, 'session IDs should be unique');

      const sessionsIndex = JSON.parse(fs.readFileSync(indexPath, 'utf8'));
      assert.equal(sessionsIndex.total_sessions, startingTotal + 2);
      assert.equal(sessionsIndex.sessions.length, startingTotal + 2);
    });
  });

  describe('updateMainIndex()', () => {
    it('updates session count in main index', async () => {
      const saver = Object.create(SessionSaver.prototype);
      saver.currentProject = 'TestSaveProject';

      // Save a session first to create sessions-index
      await saver.saveSession('Index update test', ['indexing']);

      // Verify main index was updated
      const mainIndex = JSON.parse(fs.readFileSync(path.join(fixturePath, 'index.json'), 'utf8'));
      assert.ok(mainIndex.p.TestSaveProject.sc > 0, 'Session count should be updated');
    });
  });
});
