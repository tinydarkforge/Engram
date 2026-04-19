#!/usr/bin/env node

const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const http = require('http');
const { connect, createStub } = require('../scripts/agentbridge-client');

describe('AgentBridge Client', () => {
  describe('createStub()', () => {
    it('returns an object with the correct interface', () => {
      const stub = createStub();
      assert.equal(typeof stub.emit, 'function');
      assert.equal(typeof stub.heartbeat, 'function');
      assert.equal(typeof stub.isConnected, 'function');
    });

    it('emit returns { sent: false }', async () => {
      const stub = createStub();
      const result = await stub.emit('memex.session.saved', { session_id: 'test' });
      assert.deepEqual(result, { sent: false });
    });

    it('heartbeat returns { sent: false }', async () => {
      const stub = createStub();
      const result = await stub.heartbeat('healthy');
      assert.deepEqual(result, { sent: false });
    });

    it('isConnected returns false', () => {
      const stub = createStub();
      assert.equal(stub.isConnected(), false);
    });
  });

  describe('connect() without URL', () => {
    it('returns a stub when no AGENTBRIDGE_URL is set', async () => {
      const originalUrl = process.env.AGENTBRIDGE_URL;
      delete process.env.AGENTBRIDGE_URL;

      const client = await connect();
      assert.equal(client.isConnected(), false);

      const emitResult = await client.emit('test', {});
      assert.deepEqual(emitResult, { sent: false });

      if (originalUrl) process.env.AGENTBRIDGE_URL = originalUrl;
    });
  });

  describe('connect() with unreachable server', () => {
    it('returns a stub when server is unreachable', async () => {
      const client = await connect({ url: 'http://127.0.0.1:19999' });
      assert.equal(client.isConnected(), false);

      const emitResult = await client.emit('test', {});
      assert.deepEqual(emitResult, { sent: false });
    });
  });

  describe('with mock AgentBridge server', () => {
    let server;
    let serverUrl;
    let receivedRequests;

    before(async () => {
      receivedRequests = [];

      server = http.createServer((req, res) => {
        let body = '';
        req.on('data', (chunk) => (body += chunk));
        req.on('end', () => {
          receivedRequests.push({
            method: req.method,
            url: req.url,
            headers: req.headers,
            body: body ? JSON.parse(body) : null,
          });
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ ok: true }));
        });
      });

      await new Promise((resolve) => {
        server.listen(0, '127.0.0.1', () => {
          const addr = server.address();
          serverUrl = `http://127.0.0.1:${addr.port}`;
          resolve();
        });
      });
    });

    after(async () => {
      server.closeAllConnections();
      await new Promise((resolve) => server.close(resolve));
    });

    it('connects, registers agent, and registers 3 event schemas', async () => {
      receivedRequests = [];
      const client = await connect({ url: serverUrl });

      assert.equal(client.isConnected(), true);

      // 1 health check GET + 1 agent POST + 3 schema POSTs = 5 requests
      assert.equal(receivedRequests.length, 5);

      // Health check
      assert.equal(receivedRequests[0].method, 'GET');
      assert.equal(receivedRequests[0].url, '/health');

      // Agent registration
      assert.equal(receivedRequests[1].method, 'POST');
      assert.equal(receivedRequests[1].url, '/agents');
      assert.equal(receivedRequests[1].body.agent_id, 'memex');

      // Schema registrations
      const schemas = receivedRequests.slice(2);
      assert.equal(schemas.length, 3);
      schemas.forEach((req) => {
        assert.equal(req.method, 'POST');
        assert.equal(req.url, '/bus/schemas');
        assert.ok(req.body.event_type.startsWith('memex.'));
      });
    });

    it('emits events with correct payload shape', async () => {
      receivedRequests = [];
      const client = await connect({ url: serverUrl });

      receivedRequests = []; // reset after connect
      await client.emit('memex.session.saved', {
        session_id: 'test-123',
        project: 'TestProject',
        summary: 'Test session',
      });

      assert.equal(receivedRequests.length, 1);
      const req = receivedRequests[0];
      assert.equal(req.method, 'POST');
      assert.equal(req.url, '/bus/events');
      assert.equal(req.body.event_type, 'memex.session.saved');
      assert.equal(req.body.agent_id, 'memex');
      assert.ok(req.body.timestamp);
      assert.equal(req.body.metadata.session_id, 'test-123');
      assert.equal(req.body.metadata.project, 'TestProject');
    });

    it('sends auth token in headers when provided', async () => {
      receivedRequests = [];
      const client = await connect({ url: serverUrl, token: 'test-secret-token' });

      // All requests should have the auth header
      receivedRequests.forEach((req) => {
        assert.equal(req.headers['authorization'], 'Bearer test-secret-token');
      });
    });

    it('heartbeat sends correct payload', async () => {
      receivedRequests = [];
      const client = await connect({ url: serverUrl });

      receivedRequests = []; // reset after connect
      await client.heartbeat('healthy');

      assert.equal(receivedRequests.length, 1);
      const req = receivedRequests[0];
      assert.equal(req.method, 'POST');
      assert.equal(req.url, '/agents/memex/heartbeat');
      assert.equal(req.body.status, 'healthy');
      assert.ok(req.body.timestamp);
    });
  });
});
