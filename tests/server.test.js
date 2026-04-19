#!/usr/bin/env node

const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const http = require('http');
const fs = require('fs');
const path = require('path');
const os = require('os');

/**
 * Server API tests
 *
 * Starts the Express app on a random port, hits each endpoint,
 * and validates response shape. Uses only Node built-ins (no supertest).
 */

function fetch(url) {
  return new Promise((resolve, reject) => {
    http.get(url, { agent: false }, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        try {
          resolve({ status: res.statusCode, json: JSON.parse(data) });
        } catch {
          resolve({ status: res.statusCode, text: data });
        }
      });
    }).on('error', reject);
  });
}

function postJSON(url, body) {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify(body);
    const parsed = new URL(url);
    const req = http.request({
      hostname: parsed.hostname,
      port: parsed.port,
      path: parsed.pathname,
      method: 'POST',
      agent: false,
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(data),
      },
    }, (res) => {
      let body = '';
      res.on('data', (chunk) => { body += chunk; });
      res.on('end', () => {
        try {
          resolve({ status: res.statusCode, json: JSON.parse(body) });
        } catch {
          resolve({ status: res.statusCode, text: body });
        }
      });
    });
    req.on('error', reject);
    req.write(data);
    req.end();
  });
}

describe('server API', () => {
  let server;
  let baseUrl;
  let tmpDir;

  before((_, done) => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'memex-server-'));

    const index = {
      v: 'test',
      u: '2026-01-01',
      m: { ts: 1 },
      p: { TestProject: { sc: 1, u: '2026-01-01', d: '' } },
      t: {},
      g: {}
    };

    fs.writeFileSync(path.join(tmpDir, 'index.json'), JSON.stringify(index, null, 2));

    const sessionsDir = path.join(tmpDir, 'summaries', 'projects', 'TestProject');
    fs.mkdirSync(sessionsDir, { recursive: true });
    fs.writeFileSync(path.join(sessionsDir, 'sessions-index.json'), JSON.stringify({
      project: 'TestProject',
      total_sessions: 1,
      last_updated: '2026-01-01',
      sessions: [
        { id: 'session-001', project: 'TestProject', date: '2026-01-01', summary: 'Test', topics: ['test'] }
      ],
      topics_index: { test: ['session-001'] }
    }, null, 2));

    process.env.MEMEX_PATH = tmpDir;
    process.env.HOST = '127.0.0.1';

    // Clear module cache so Memex re-initializes
    const keysToDelete = Object.keys(require.cache).filter(k =>
      k.includes('memex-loader') || k.includes('server.js') ||
      k.includes('persistent-cache') || k.includes('safe-json') ||
      k.includes('agentbridge-client')
    );
    keysToDelete.forEach(k => delete require.cache[k]);

    const app = require('../scripts/server');
    server = app.listen(0, '127.0.0.1', () => {
      const port = server.address().port;
      baseUrl = `http://127.0.0.1:${port}`;
      done();
    });
  });

  after((_, done) => {
    delete process.env.MEMEX_PATH;
    delete process.env.HOST;
    if (tmpDir) {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
    if (server) {
      server.closeAllConnections();
      server.unref();
      server.close(done);
    } else {
      done();
    }
  });

  it('GET /api/stats returns overview', async () => {
    const { status, json } = await fetch(`${baseUrl}/api/stats`);
    assert.equal(status, 200);
    assert.equal(typeof json.totalSessions, 'number');
    assert.ok(Array.isArray(json.projects));
    assert.equal(typeof json.totalTopics, 'number');
    assert.ok(json.version);
  });

  it('GET /health returns healthy on a fresh lazy-loaded server', async () => {
    const freshDir = fs.mkdtempSync(path.join(os.tmpdir(), 'memex-server-fresh-'));
    fs.writeFileSync(path.join(freshDir, 'index.json'), JSON.stringify({
      v: 'fresh-test',
      u: '2026-01-01',
      m: { ts: 0 },
      p: {},
      t: {},
      g: {}
    }, null, 2));

    const originalMemexPath = process.env.MEMEX_PATH;
    process.env.MEMEX_PATH = freshDir;

    const keysToDelete = Object.keys(require.cache).filter(k =>
      k.includes('memex-loader') || k.includes('server.js') ||
      k.includes('persistent-cache') || k.includes('safe-json') ||
      k.includes('agentbridge-client')
    );
    keysToDelete.forEach(k => delete require.cache[k]);

    const freshApp = require('../scripts/server');
    const freshServer = await new Promise((resolve) => {
      const instance = freshApp.listen(0, '127.0.0.1', () => resolve(instance));
    });
    const freshBaseUrl = `http://127.0.0.1:${freshServer.address().port}`;

    try {
      const { status, json } = await fetch(`${freshBaseUrl}/health`);
      assert.equal(status, 200);
      assert.equal(json.status, 'healthy');
      assert.equal(json.version, 'fresh-test');
    } finally {
      freshServer.closeAllConnections();
      freshServer.unref();
      await new Promise(resolve => freshServer.close(resolve));
      if (originalMemexPath === undefined) delete process.env.MEMEX_PATH;
      else process.env.MEMEX_PATH = originalMemexPath;
      fs.rmSync(freshDir, { recursive: true, force: true });
    }
  });

  it('GET /api/projects returns project list', async () => {
    const { status, json } = await fetch(`${baseUrl}/api/projects`);
    assert.equal(status, 200);
    assert.equal(typeof json.total, 'number');
    assert.ok(Array.isArray(json.projects));
    if (json.projects.length > 0) {
      assert.ok(json.projects[0].name);
      assert.equal(typeof json.projects[0].sessions, 'number');
    }
  });

  it('GET /api/topics returns topics', async () => {
    const { status, json } = await fetch(`${baseUrl}/api/topics`);
    assert.equal(status, 200);
    assert.equal(typeof json.total, 'number');
    assert.ok(Array.isArray(json.topics));
  });

  it('GET /api/search?q= returns results', async () => {
    const { status, json } = await fetch(`${baseUrl}/api/search?q=test`);
    assert.equal(status, 200);
    assert.equal(json.query, 'test');
    assert.ok(Array.isArray(json.results));
    assert.equal(typeof json.total, 'number');
  });

  it('GET /api/search with empty query returns empty', async () => {
    const { status, json } = await fetch(`${baseUrl}/api/search?q=`);
    assert.equal(status, 200);
    assert.deepEqual(json.results, []);
  });

  it('GET /api/sessions/:project returns sessions array', async () => {
    // Use the first project from index, or a dummy name
    const projRes = await fetch(`${baseUrl}/api/projects`);
    const projectName = projRes.json.projects[0]?.name || 'NonExistent';
    const { status, json } = await fetch(`${baseUrl}/api/sessions/${projectName}`);
    assert.equal(status, 200);
    assert.ok(Array.isArray(json.sessions));
    assert.equal(json.project, projectName);
  });

  it('GET /api/graph returns nodes and edges', async () => {
    const { status, json } = await fetch(`${baseUrl}/api/graph`);
    assert.equal(status, 200);
    assert.ok(Array.isArray(json.nodes));
    assert.ok(Array.isArray(json.edges));
  });

  it('POST /api/semantic-search with empty query returns empty', async () => {
    const { status, json } = await postJSON(`${baseUrl}/api/semantic-search`, { query: '' });
    assert.equal(status, 200);
    assert.deepEqual(json.results, []);
  });

  it('GET /health returns status and uptime', async () => {
    const { status, json } = await fetch(`${baseUrl}/health`);
    assert.equal(status, 200);
    assert.equal(json.status, 'healthy');
    assert.equal(typeof json.uptime, 'number');
    assert.ok(json.timestamp);
    assert.ok(json.version);
  });

  it('GET /api/assertions returns assertions list', async () => {
    const { status, json } = await fetch(`${baseUrl}/api/assertions`);
    assert.equal(status, 200);
    assert.ok(Array.isArray(json.assertions));
    assert.equal(typeof json.total, 'number');
    assert.equal(typeof json.page, 'number');
    assert.equal(typeof json.limit, 'number');
  });

  it('POST /api/feedback with valid body returns ok or 400', async () => {
    const { status } = await postJSON(`${baseUrl}/api/feedback`, {
      sessionId: 's1',
      assertionId: 'a1',
      signal: 'helpful',
    });
    assert.ok(status === 200 || status === 400, `expected 200 or 400, got ${status}`);
    assert.notEqual(status, 500);
  });
});
