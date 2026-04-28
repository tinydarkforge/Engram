#!/usr/bin/env node

const { describe, it, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const os = require('os');
const BloomFilter = require('../scripts/bloom-filter');

// Create a minimal test fixture that mimics the Engram data structure
function createTestFixture() {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'engram-test-'));

  const index = {
    v: '4.0.0',
    u: new Date().toISOString(),
    m: { tp: 2, ts: 3, gs: 5 },
    g: {
      cs: { s: 'Conventional Commits', qr: { format: '<type>(<scope>): <desc>' } },
      pg: { s: 'PR Guidelines', qr: { rule: '1 approval' } },
      bs: { s: 'Branching Strategy', qr: { prefixes: ['feature/', 'fix/'] } },
      cd: { s: 'Code Standards', qr: { style: 'ESLint' } },
      sc: { s: 'Security', qr: { rule: 'No secrets in code' } },
    },
    p: {
      TestProject: {
        d: 'A test project for unit tests',
        ts: ['Node.js', 'JavaScript'],
        sc: 2,
        u: '2025-12-01',
        mf: 'metadata/projects/TestProject.json',
        qr: { env: { dev: 'http://localhost:3000' }, own: ['@tester'] },
        tp: ['testing', 'nodejs'],
      },
      AnotherProject: {
        d: 'Another project',
        ts: ['Python'],
        sc: 1,
        u: '2025-11-01',
        mf: 'metadata/projects/AnotherProject.json',
        qr: {},
        tp: ['python'],
      },
    },
    t: {
      auth: { p: ['TestProject'], sc: 1 },
      testing: { p: ['TestProject', 'AnotherProject'], sc: 2 },
    },
    _legend: {
      root: { v: 'version', m: 'metadata', g: 'global_standards', p: 'projects', t: 'topics' },
    },
  };

  // Write index.json
  fs.writeFileSync(path.join(tmpDir, 'index.json'), JSON.stringify(index, null, 2));

  // Create metadata dir
  fs.mkdirSync(path.join(tmpDir, 'metadata', 'projects'), { recursive: true });
  fs.writeFileSync(
    path.join(tmpDir, 'metadata', 'projects', 'TestProject.json'),
    JSON.stringify({ ts: ['Node.js', 'JavaScript'], a: 'monolith' })
  );

  // Create sessions
  fs.mkdirSync(path.join(tmpDir, 'summaries', 'projects', 'TestProject', 'sessions'), { recursive: true });
  const sessionsIndex = {
    project: 'TestProject',
    total_sessions: 2,
    last_updated: '2025-12-01',
    sessions: [
      { id: 'tp-2025-12-01-auth-abc1', project: 'TestProject', date: '2025-12-01', summary: 'Added auth', topics: ['auth'] },
      { id: 'tp-2025-11-15-setup-xyz2', project: 'TestProject', date: '2025-11-15', summary: 'Project setup', topics: ['testing'] },
    ],
    topics_index: { auth: ['tp-2025-12-01-auth-abc1'], testing: ['tp-2025-11-15-setup-xyz2'] },
  };
  fs.writeFileSync(
    path.join(tmpDir, 'summaries', 'projects', 'TestProject', 'sessions-index.json'),
    JSON.stringify(sessionsIndex, null, 2)
  );

  // Write a session detail file
  fs.writeFileSync(
    path.join(tmpDir, 'summaries', 'projects', 'TestProject', 'sessions', 'tp-2025-12-01-auth-abc1.json'),
    JSON.stringify({
      id: 'tp-2025-12-01-auth-abc1',
      key_decisions: [{ decision: 'Use JWT' }],
      outcomes: { completed: ['Auth flow'] },
      learnings: ['JWT is stateless'],
    })
  );

  // Create .cache dir
  fs.mkdirSync(path.join(tmpDir, '.cache'), { recursive: true });

  const bloomFilter = new BloomFilter(64, 0.01);
  ['auth', 'testing', 'tests', 'unit', 'added', 'project', 'setup', 'testproject'].forEach((term) => bloomFilter.add(term));
  fs.writeFileSync(
    path.join(tmpDir, '.cache', 'bloom-filter.json'),
    JSON.stringify(bloomFilter.toJSON(), null, 2)
  );

  return tmpDir;
}

function cleanupFixture(tmpDir) {
  fs.rmSync(tmpDir, { recursive: true, force: true });
}

// We need to override the path resolution so engram-loader uses our fixture
function loadEngramWithFixture(fixturePath) {
  // Clear module cache to get fresh instances
  const modulesToClear = Object.keys(require.cache).filter(
    (k) => k.includes('engram-loader') || k.includes('persistent-cache') || k.includes('manifest-manager') || k.includes('vector-search') || k.includes('bloom-filter') || k.includes('paths')
  );
  modulesToClear.forEach((k) => delete require.cache[k]);

  // Override resolveEngramPath before requiring engram-loader
  const pathsModule = require('../scripts/paths');
  const originalResolve = pathsModule.resolveEngramPath;
  pathsModule.resolveEngramPath = () => fixturePath;

  const Engram = require('../scripts/engram-loader');
  return { Engram, restore: () => { pathsModule.resolveEngramPath = originalResolve; } };
}

describe('Engram Loader', () => {
  let fixturePath;
  let Engram;
  let restore;

  before(() => {
    fixturePath = createTestFixture();
    const loaded = loadEngramWithFixture(fixturePath);
    Engram = loaded.Engram;
    restore = loaded.restore;
  });

  after(() => {
    restore();
    cleanupFixture(fixturePath);
  });

  describe('loadIndex()', () => {
    it('loads index from JSON', () => {
      const engram = new Engram();
      const result = engram.loadIndex();

      assert.equal(result.loaded, true);
      assert.equal(result.format, 'json');
      assert.ok(result.projects.includes('TestProject'));
      assert.ok(result.projects.includes('AnotherProject'));
      assert.equal(result.total_sessions, 3);
    });

    it('returns correct project count', () => {
      const engram = new Engram();
      const result = engram.loadIndex();
      assert.equal(result.projects.length, 2);
    });

    it('returns correct global standards count', () => {
      const engram = new Engram();
      const result = engram.loadIndex();
      assert.equal(result.global_standards.length, 5);
    });
  });

  describe('quickAnswer()', () => {
    it('answers commit questions from index', () => {
      const engram = new Engram();
      engram.loadIndex();
      const answer = engram.quickAnswer('what is our commit format?');
      assert.deepEqual(answer, { format: '<type>(<scope>): <desc>' });
    });

    it('answers PR questions from index', () => {
      const engram = new Engram();
      engram.loadIndex();
      const answer = engram.quickAnswer('pull request guidelines');
      assert.deepEqual(answer, { rule: '1 approval' });
    });

    it('answers branch questions from index', () => {
      const engram = new Engram();
      engram.loadIndex();
      const answer = engram.quickAnswer('branching strategy');
      assert.deepEqual(answer, { prefixes: ['feature/', 'fix/'] });
    });

    it('answers security questions from index', () => {
      const engram = new Engram();
      engram.loadIndex();
      const answer = engram.quickAnswer('security policy');
      assert.deepEqual(answer, { rule: 'No secrets in code' });
    });

    it('returns null for unknown queries', () => {
      const engram = new Engram();
      engram.loadIndex();
      const answer = engram.quickAnswer('favorite pizza topping');
      assert.equal(answer, null);
    });
  });

  describe('search()', () => {
    it('finds topics by keyword', () => {
      const engram = new Engram();
      engram.loadIndex();
      const results = engram.search('auth');

      assert.ok(results.total > 0);
      const topicResult = results.results.find((r) => r.type === 'topic');
      assert.ok(topicResult);
      assert.equal(topicResult.topic, 'auth');
    });

    it('finds projects by name', () => {
      const engram = new Engram();
      engram.loadIndex();
      const results = engram.search('TestProject');

      const projectResult = results.results.find((r) => r.type === 'project');
      assert.ok(projectResult);
      assert.equal(projectResult.project, 'TestProject');
    });

    it('finds projects by description', () => {
      const engram = new Engram();
      engram.loadIndex();
      const results = engram.search('unit tests');

      const projectResult = results.results.find((r) => r.type === 'project');
      assert.ok(projectResult);
      assert.equal(projectResult.project, 'TestProject');
    });

    it('finds sessions by summary text', () => {
      const engram = new Engram();
      engram.loadIndex();
      const results = engram.search('project setup');

      const sessionResult = results.results.find((r) => r.type === 'session');
      assert.ok(sessionResult);
      assert.equal(sessionResult.session_id, 'tp-2025-11-15-setup-xyz2');
    });

    it('does not bloom-skip multi-word queries when one term exists', () => {
      const engram = new Engram();
      engram.loadIndex();
      const results = engram.search('auth workflow');

      assert.equal(results.bloom_filter_skip, false);
      assert.equal(Array.isArray(results.results), true);
    });

    it('returns empty for nonexistent terms', () => {
      const engram = new Engram();
      engram.loadIndex();
      const results = engram.search('xyznonexistent');
      assert.equal(results.total, 0);
    });
  });

  describe('listProjects()', () => {
    it('lists all projects with metadata', () => {
      const engram = new Engram();
      engram.loadIndex();
      const projects = engram.listProjects();

      assert.equal(projects.length, 2);
      const tp = projects.find((p) => p.name === 'TestProject');
      assert.ok(tp);
      assert.equal(tp.session_count, 2);
      assert.deepEqual(tp.tech_stack, ['Node.js', 'JavaScript']);
    });
  });

  describe('listSessions()', () => {
    it('lists sessions for a project', () => {
      const engram = new Engram();
      engram.loadIndex();
      const sessions = engram.listSessions('TestProject');

      assert.equal(sessions.length, 2);
      assert.equal(sessions[0].id, 'tp-2025-12-01-auth-abc1');
      assert.equal(sessions[1].id, 'tp-2025-11-15-setup-xyz2');
    });

    it('returns empty array for nonexistent project', () => {
      const engram = new Engram();
      engram.loadIndex();
      const sessions = engram.listSessions('NonExistent');
      assert.deepEqual(sessions, []);
    });
  });

  describe('loadSessionDetails()', () => {
    it('loads session details from file', () => {
      const engram = new Engram();
      engram.loadIndex();
      const details = engram.loadSessionDetails('TestProject', 'tp-2025-12-01-auth-abc1');

      assert.ok(details);
      assert.equal(details.id, 'tp-2025-12-01-auth-abc1');
      assert.deepEqual(details.key_decisions, [{ decision: 'Use JWT' }]);
      assert.equal(details.from_cache, false);
    });

    it('falls back to sessions-index for non-lazy sessions', () => {
      const engram = new Engram();
      engram.loadIndex();
      // This session has no detail file, should fall back to sessions-index
      const details = engram.loadSessionDetails('TestProject', 'tp-2025-11-15-setup-xyz2');

      assert.ok(details);
      assert.equal(details.id, 'tp-2025-11-15-setup-xyz2');
      assert.equal(details.legacy_format, true);
    });

    it('returns null for nonexistent session', () => {
      const engram = new Engram();
      engram.loadIndex();
      const details = engram.loadSessionDetails('TestProject', 'nonexistent-session');
      assert.equal(details, null);
    });
  });

  describe('loadProjectMetadata()', () => {
    it('loads metadata from file', () => {
      const engram = new Engram();
      engram.loadIndex();
      const metadata = engram.loadProjectMetadata('TestProject');

      assert.ok(metadata);
      assert.deepEqual(metadata.ts, ['Node.js', 'JavaScript']);
    });

    it('returns null for nonexistent project', () => {
      const engram = new Engram();
      engram.loadIndex();
      const metadata = engram.loadProjectMetadata('NonExistent');
      assert.equal(metadata, null);
    });
  });

  describe('expand()', () => {
    it('expands abbreviated keys using legend', () => {
      const engram = new Engram();
      engram.loadIndex();
      const expanded = engram.expand({ v: '4.0.0', m: 'test' }, 'root');

      assert.equal(expanded.version, '4.0.0');
      assert.equal(expanded.metadata, 'test');
    });

    it('returns data as-is when no legend exists for context', () => {
      const engram = new Engram();
      engram.loadIndex();
      const data = { foo: 'bar' };
      const expanded = engram.expand(data, 'nonexistent');
      assert.deepEqual(expanded, data);
    });
  });

  describe('startup()', () => {
    it('returns complete startup payload', () => {
      const engram = new Engram();
      const result = engram.startup();

      assert.equal(result.status, 'ready');
      assert.equal(result.version, '4.0.0');
      assert.ok(result.load_time_ms >= 0);
      assert.equal(result.index.projects, 2);
      assert.equal(result.index.global_standards, 5);
      assert.equal(result.index.total_sessions, 3);
      assert.ok(result.global_standards.commit);
      assert.ok(result.global_standards.pr);
      assert.ok(result.global_standards.branching);
      assert.ok(result.global_standards.code);
      assert.ok(result.global_standards.security);
    });
  });
});
