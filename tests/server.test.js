#!/usr/bin/env node

const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const http = require('http');

/**
 * Server API tests
 *
 * Starts the Express app on a random port, hits each endpoint,
 * and validates response shape. Uses only Node built-ins (no supertest).
 */

function fetch(url) {
  return new Promise((resolve, reject) => {
    http.get(url, (res) => {
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

  before((_, done) => {
    // Clear module cache so Memex re-initializes
    const keysToDelete = Object.keys(require.cache).filter(k =>
      k.includes('memex-loader') || k.includes('server.js') ||
      k.includes('persistent-cache') || k.includes('safe-json') ||
      k.includes('agentbridge-client')
    );
    keysToDelete.forEach(k => delete require.cache[k]);

    const app = require('../scripts/server');
    server = app.listen(0, () => {
      const port = server.address().port;
      baseUrl = `http://127.0.0.1:${port}`;
      done();
    });
  });

  after((_, done) => {
    if (server) {
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
});
