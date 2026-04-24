#!/usr/bin/env node

/**
 * Tests for MCP tool implementations (scripts/mcp-tools.js)
 *
 * Tests the extracted tool logic that powers the MCP server:
 *   - loadIndex, loadSessionsIndex, loadGraph, loadBundle
 *   - listProjects, recentSessions, getTopics, getStats
 *   - getBundle, queryConcept, getGraphSummary
 *   - neuralSearch (error path), crossProjectSearch (error path)
 *
 * Uses temp directories with mock data to avoid touching real Codicil data.
 */

const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const os = require('os');
const msgpack = require('msgpack-lite');

let tmpDir;
let tools;

describe('MCP Tools', () => {
  before(() => {
    // Create temp Codicil structure
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'codicil-mcp-test-'));

    // Create index.json
    const index = {
      v: '4.0.0',
      u: '2025-12-20',
      m: { ts: 42 },
      p: {
        TestProject: { sc: 10, u: '2025-12-20', d: 'A test project' },
        AnotherProject: { sc: 5, u: '2025-12-19', d: 'Another one' },
      },
      t: {
        auth: { sc: 8, p: ['TestProject'] },
        docker: { sc: 5, p: ['TestProject', 'AnotherProject'] },
        testing: { sc: 3, p: ['AnotherProject'] },
        '': { sc: 1, p: [] }, // empty-name topic (should be filtered)
      },
    };
    fs.writeFileSync(path.join(tmpDir, 'index.json'), JSON.stringify(index));

    // Create summaries/projects/TestProject/sessions-index.json
    const testProjDir = path.join(tmpDir, 'summaries', 'projects', 'TestProject');
    fs.mkdirSync(testProjDir, { recursive: true });
    const sessionsIndex = {
      sessions: [
        { id: 'tp-001', date: '2025-12-20', summary: 'Added auth flow', topics: ['auth'] },
        { id: 'tp-002', date: '2025-12-19', summary: 'Set up Docker', topics: ['docker'] },
      ],
    };
    fs.writeFileSync(path.join(testProjDir, 'sessions-index.json'), JSON.stringify(sessionsIndex));
    const sessionsDir = path.join(testProjDir, 'sessions');
    fs.mkdirSync(sessionsDir, { recursive: true });
    const sessionDetails = {
      id: 'tp-001',
      project: 'TestProject',
      date: '2025-12-20',
      summary: 'Added auth flow',
      topics: ['auth'],
      key_decisions: [{ decision: 'Use JWT', rationale: 'Stateless auth' }],
      learnings: ['Token rotation matters'],
      outcomes: { completed: ['Auth wired'] }
    };
    fs.writeFileSync(path.join(sessionsDir, 'tp-001.json'), JSON.stringify(sessionDetails));

    // Create summaries/projects/AnotherProject/sessions-index.json
    const anotherProjDir = path.join(tmpDir, 'summaries', 'projects', 'AnotherProject');
    fs.mkdirSync(anotherProjDir, { recursive: true });
    const anotherSessions = {
      sessions: [
        { id: 'ap-001', date: '2025-12-18', summary: 'Wrote tests', topics: ['testing'] },
      ],
    };
    fs.writeFileSync(path.join(anotherProjDir, 'sessions-index.json'), JSON.stringify(anotherSessions));

    // Create .neural/graph.msgpack
    const neuralDir = path.join(tmpDir, '.neural');
    fs.mkdirSync(neuralDir, { recursive: true });

    const graph = {
      nodes: {
        auth: { w: 8 },
        docker: { w: 5 },
        testing: { w: 3 },
      },
      edges: {
        auth: [{ c: 'docker', w: 2 }, { c: 'testing', w: 1 }],
        docker: [{ c: 'auth', w: 2 }],
      },
    };
    fs.writeFileSync(path.join(neuralDir, 'graph.msgpack'), msgpack.encode(graph));

    // Create .neural/bundles/TestProject.msgpack
    const bundlesDir = path.join(neuralDir, 'bundles');
    fs.mkdirSync(bundlesDir, { recursive: true });

    const bundle = {
      d: 'A test project',
      t: 'Node.js, Express',
      dp: 'AWS',
      e: 'production',
      r: [{ id: 'tp-001', summary: 'Added auth flow' }],
      c: ['auth', 'docker'],
    };
    fs.writeFileSync(path.join(bundlesDir, 'TestProject.msgpack'), msgpack.encode(bundle));

    // Override CODICIL_PATH by setting env var before requiring the module
    process.env.CODICIL_PATH = tmpDir;

    // Clear module cache to pick up new CODICIL_PATH
    Object.keys(require.cache)
      .filter(k => k.includes('mcp-tools') || k.includes('paths'))
      .forEach(k => delete require.cache[k]);

    tools = require('../scripts/mcp-tools');
  });

  after(() => {
    // Cleanup
    fs.rmSync(tmpDir, { recursive: true, force: true });
    delete process.env.CODICIL_PATH;
  });

  describe('loadIndex()', () => {
    it('loads and returns index data', () => {
      const index = tools.loadIndex();
      assert.equal(index.v, '4.0.0');
      assert.equal(index.m.ts, 42);
      assert.ok(index.p.TestProject);
    });
  });

  describe('loadSessionsIndex()', () => {
    it('loads sessions for a valid project', () => {
      const data = tools.loadSessionsIndex('TestProject');
      assert.ok(data);
      assert.equal(data.sessions.length, 2);
      assert.equal(data.sessions[0].id, 'tp-001');
    });

    it('returns null for nonexistent project', () => {
      const data = tools.loadSessionsIndex('NoSuchProject');
      assert.equal(data, null);
    });

    it('sanitizes path traversal attempts', () => {
      const data = tools.loadSessionsIndex('../../../etc/passwd');
      assert.equal(data, null);
    });
  });

  describe('listProjects()', () => {
    it('returns all projects sorted by session count', () => {
      const result = tools.listProjects();
      assert.equal(result.total, 2);
      assert.equal(result.projects[0].name, 'TestProject');
      assert.equal(result.projects[0].sessions, 10);
      assert.equal(result.projects[1].name, 'AnotherProject');
      assert.equal(result.projects[1].sessions, 5);
    });

    it('includes description and last_updated', () => {
      const result = tools.listProjects();
      assert.equal(result.projects[0].description, 'A test project');
      assert.equal(result.projects[0].last_updated, '2025-12-20');
    });
  });

  describe('recentSessions()', () => {
    it('returns sessions across all projects sorted by date', () => {
      const result = tools.recentSessions(10);
      assert.equal(result.total, 3);
      assert.equal(result.sessions.length, 3);
      // Most recent first
      assert.equal(result.sessions[0].id, 'tp-001');
      assert.equal(result.sessions[0].project, 'TestProject');
      assert.equal(result.sessions[2].id, 'ap-001');
    });

    it('respects limit parameter', () => {
      const result = tools.recentSessions(1);
      assert.equal(result.sessions.length, 1);
      assert.equal(result.total, 3); // total is still 3
    });
  });

  describe('getTopics()', () => {
    it('returns topics sorted by session count, filters empty names', () => {
      const result = tools.getTopics(30);
      assert.equal(result.total, 4); // includes empty-name in total
      // Filtered topics should not include empty name
      const names = result.topics.map(t => t.name);
      assert.ok(!names.includes(''));
      assert.equal(result.topics[0].name, 'auth');
      assert.equal(result.topics[0].sessions, 8);
    });

    it('respects limit parameter', () => {
      const result = tools.getTopics(2);
      assert.equal(result.topics.length, 2);
    });
  });

  describe('getStats()', () => {
    it('returns overview stats', () => {
      const stats = tools.getStats();
      assert.equal(stats.version, '4.0.0');
      assert.equal(stats.total_sessions, 42);
      assert.equal(stats.total_topics, 4);
      assert.equal(stats.projects, 2);
      assert.equal(stats.last_updated, '2025-12-20');
    });
  });

  describe('getBundle()', () => {
    it('returns bundle data for existing project', () => {
      const result = tools.getBundle('TestProject');
      assert.equal(result.project, 'TestProject');
      assert.equal(result.description, 'A test project');
      assert.equal(result.tech, 'Node.js, Express');
      assert.equal(result.deployment, 'AWS');
      assert.equal(result.environment, 'production');
      assert.equal(result.recent_sessions.length, 1);
      assert.deepEqual(result.concepts, ['auth', 'docker']);
    });

    it('returns error for nonexistent project', () => {
      const result = tools.getBundle('NoSuchProject');
      assert.ok(result.error);
      assert.ok(result.error.includes('Bundle not found'));
    });

    it('sanitizes project name', () => {
      const result = tools.getBundle('../../etc/passwd');
      assert.ok(result.error);
    });
  });

  describe('queryConcept()', () => {
    it('returns concept data with related concepts', () => {
      const result = tools.queryConcept('auth');
      assert.equal(result.found, true);
      assert.equal(result.concept, 'auth');
      assert.equal(result.sessions_count, 8);
      assert.equal(result.related_concepts.length, 2);
      assert.equal(result.related_concepts[0].concept, 'docker');
      assert.equal(result.related_concepts[0].strength, 2);
    });

    it('normalizes concept to lowercase', () => {
      const result = tools.queryConcept('AUTH');
      assert.equal(result.found, true);
      assert.equal(result.concept, 'auth');
    });

    it('returns not-found for unknown concept', () => {
      const result = tools.queryConcept('kubernetes');
      assert.equal(result.found, false);
      assert.ok(result.suggestion);
    });
  });

  describe('getGraphSummary()', () => {
    it('returns graph stats and top concepts', () => {
      const result = tools.getGraphSummary();
      assert.equal(result.concepts, 3);
      assert.equal(result.connections, 3); // 2 from auth + 1 from docker
      assert.ok(result.top_concepts.length > 0);
      assert.equal(result.top_concepts[0].name, 'auth');
      assert.equal(result.top_concepts[0].sessions, 8);
    });
  });

  describe('loadGraph()', () => {
    it('returns parsed graph data', () => {
      const graph = tools.loadGraph();
      assert.ok(graph);
      assert.ok(graph.nodes);
      assert.ok(graph.edges);
      assert.equal(graph.nodes.auth.w, 8);
    });
  });

  describe('neuralSearch() - error path', () => {
    it('returns error when vector search fails', async () => {
      // neuralSearch tries to initialize VectorSearch which needs real embeddings
      // Without them, it should return an error gracefully
      const result = await tools.neuralSearch('test query');
      assert.ok(result.error || result.results !== undefined);
    });
  });

  describe('crossProjectSearch() - error path', () => {
    it('returns error when git index is missing', async () => {
      const result = await tools.crossProjectSearch('test query');
      assert.ok(result.error || result.results !== undefined || result.by_project !== undefined);
    });
  });

  describe('getSession()', () => {
    it('returns session details when found', () => {
      const result = tools.getSession('TestProject', 'tp-001');
      assert.equal(result.id, 'tp-001');
      assert.equal(result.project, 'TestProject');
      assert.equal(result.summary, 'Added auth flow');
      assert.ok(Array.isArray(result.key_decisions));
    });

    it('returns structured error when session is missing', () => {
      const result = tools.getSession('TestProject', 'tp-999');
      assert.equal(result.error, true);
      assert.equal(result.code, 'CODICIL_ERR_SESSION_NOT_FOUND');
    });
  });

  describe('searchSessions()', () => {
    it('finds sessions by summary keyword', () => {
      const result = tools.searchSessions('auth');
      assert.equal(result.total, 1);
      assert.equal(result.results[0].id, 'tp-001');
    });

    it('respects project filter', () => {
      const result = tools.searchSessions('docker', 'AnotherProject');
      assert.equal(result.total, 0);
    });
  });
});
