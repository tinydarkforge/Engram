#!/usr/bin/env node

/**
 * End-to-end integration test
 *
 * Validates the full AgentBridge round-trip:
 *   1. Mock AgentBridge server receives agent registration
 *   2. Memex emits memex.session.saved event
 *   3. AgentBridge sends memex.query.requested event
 *   4. EventConsumer processes it, runs search, emits memex.query.result
 *
 * Also tests the HTTP server API with AgentBridge status endpoint.
 */

const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const http = require('http');

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

describe('E2E: AgentBridge round-trip', () => {
  let mockBridge;
  let mockBridgePort;
  let bridgeLog = [];
  let pendingEvents = [];

  before((_, done) => {
    // Create mock AgentBridge server
    mockBridge = http.createServer((req, res) => {
      let body = '';
      req.on('data', (chunk) => { body += chunk; });
      req.on('end', () => {
        const entry = {
          method: req.method,
          url: req.url,
          body: body ? JSON.parse(body) : null,
        };
        bridgeLog.push(entry);

        // Health check
        if (req.url === '/health') {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ status: 'ok' }));
          return;
        }

        // Agent registration
        if (req.url === '/agents' && req.method === 'POST') {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ registered: true }));
          return;
        }

        // Schema registration
        if (req.url === '/bus/schemas' && req.method === 'POST') {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ registered: true }));
          return;
        }

        // Event emission
        if (req.url === '/bus/events' && req.method === 'POST') {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ received: true }));
          return;
        }

        // Event polling — return pending events then clear them
        if (req.url.startsWith('/bus/events') && req.method === 'GET') {
          const events = [...pendingEvents];
          pendingEvents = [];
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify(events));
          return;
        }

        // Heartbeat
        if (req.url.includes('/heartbeat') && req.method === 'POST') {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ ok: true }));
          return;
        }

        res.writeHead(404);
        res.end();
      });
    });

    mockBridge.listen(0, () => {
      mockBridgePort = mockBridge.address().port;
      done();
    });
  });

  after((_, done) => {
    mockBridge.closeAllConnections();
    mockBridge.close(done);
  });

  it('connect() registers agent and 3 event schemas', async () => {
    bridgeLog = [];

    // Clear module cache
    Object.keys(require.cache)
      .filter(k => k.includes('agentbridge-client'))
      .forEach(k => delete require.cache[k]);

    const { connect } = require('../scripts/agentbridge-client');
    const bridge = await connect({ url: `http://127.0.0.1:${mockBridgePort}` });

    assert.equal(bridge.isConnected(), true);

    // Verify registration sequence
    const healthCheck = bridgeLog.find(e => e.url === '/health');
    assert.ok(healthCheck, 'Should health check');

    const registration = bridgeLog.find(e => e.url === '/agents' && e.method === 'POST');
    assert.ok(registration, 'Should register agent');
    assert.equal(registration.body.agent_id, 'memex');

    const schemas = bridgeLog.filter(e => e.url === '/bus/schemas');
    assert.equal(schemas.length, 3, 'Should register 3 event schemas');

    const schemaTypes = schemas.map(s => s.body.event_type).sort();
    assert.deepEqual(schemaTypes, [
      'memex.query.requested',
      'memex.query.result',
      'memex.session.saved',
    ]);
  });

  it('emit() sends event to AgentBridge', async () => {
    bridgeLog = [];

    Object.keys(require.cache)
      .filter(k => k.includes('agentbridge-client'))
      .forEach(k => delete require.cache[k]);

    const { connect } = require('../scripts/agentbridge-client');
    const bridge = await connect({ url: `http://127.0.0.1:${mockBridgePort}` });

    bridgeLog = []; // clear registration logs

    const result = await bridge.emit('memex.session.saved', {
      session_id: 'test-001',
      project: 'TestProject',
      summary: 'Added feature X',
    });

    assert.equal(result.sent, true);

    const eventPost = bridgeLog.find(e => e.url === '/bus/events' && e.method === 'POST');
    assert.ok(eventPost, 'Should POST event');
    assert.equal(eventPost.body.event_type, 'memex.session.saved');
    assert.equal(eventPost.body.agent_id, 'memex');
    assert.equal(eventPost.body.metadata.session_id, 'test-001');
    assert.equal(eventPost.body.metadata.project, 'TestProject');
  });

  it('EventConsumer processes query events and emits results', async () => {
    bridgeLog = [];

    // Inject a query event for the consumer to pick up
    pendingEvents = [{
      id: 'e2e-query-001',
      event_type: 'memex.query.requested',
      timestamp: new Date().toISOString(),
      metadata: {
        query: 'authentication',
        requester: 'test-agent',
        mode: 'keyword',
      },
    }];

    // Create mock memex with search
    const mockMemex = {
      search: (query) => ({
        query,
        results: [{ type: 'topic', topic: 'auth' }],
        total: 1,
      }),
    };

    // Create mock bridge that records emitted events
    const emitted = [];
    const mockBridgeClient = {
      emit: (type, meta) => {
        emitted.push({ type, meta });
        return Promise.resolve({ sent: true });
      },
    };

    Object.keys(require.cache)
      .filter(k => k.includes('event-consumer'))
      .forEach(k => delete require.cache[k]);

    const EventConsumer = require('../scripts/event-consumer');
    const consumer = new EventConsumer({
      url: `http://127.0.0.1:${mockBridgePort}`,
      pollInterval: 60000,
      memex: mockMemex,
      bridge: mockBridgeClient,
    });

    // Run one poll cycle
    await consumer._poll();
    consumer.stop();

    // Verify the consumer polled for events
    const pollReq = bridgeLog.find(e => e.url.includes('/bus/events') && e.method === 'GET');
    assert.ok(pollReq, 'Should poll for events');

    // Verify the consumer processed the event
    assert.equal(consumer.stats.events_received, 1);
    assert.equal(consumer.stats.events_processed, 1);

    // Verify result was emitted back
    assert.equal(emitted.length, 1);
    assert.equal(emitted[0].type, 'memex.query.result');
    assert.equal(emitted[0].meta.query, 'authentication');
    assert.equal(emitted[0].meta.source, 'keyword');
    assert.equal(emitted[0].meta.requester, 'test-agent');
    assert.equal(emitted[0].meta.in_response_to, 'e2e-query-001');
    assert.equal(typeof emitted[0].meta.latency_ms, 'number');
  });

  it('EventConsumer handles semantic search mode', async () => {
    pendingEvents = [{
      id: 'e2e-semantic-001',
      event_type: 'memex.query.requested',
      timestamp: new Date().toISOString(),
      metadata: {
        query: 'memory leak debugging',
        requester: 'another-agent',
        mode: 'semantic',
      },
    }];

    const emitted = [];
    const mockMemex = {
      semanticSearch: async (query) => ({
        query,
        results: [{ session_id: 'mem-001', score: 0.85 }],
        total: 1,
      }),
    };

    Object.keys(require.cache)
      .filter(k => k.includes('event-consumer'))
      .forEach(k => delete require.cache[k]);

    const EventConsumer = require('../scripts/event-consumer');
    const consumer = new EventConsumer({
      url: `http://127.0.0.1:${mockBridgePort}`,
      pollInterval: 60000,
      memex: mockMemex,
      bridge: { emit: (t, m) => { emitted.push({ t, m }); return Promise.resolve({ sent: true }); } },
    });

    await consumer._poll();
    consumer.stop();

    assert.equal(consumer.stats.events_processed, 1);
    assert.equal(emitted[0].m.source, 'semantic');
    assert.equal(emitted[0].m.query, 'memory leak debugging');
  });
});

describe('E2E: Server AgentBridge endpoints', () => {
  let server;
  let baseUrl;

  before((_, done) => {
    // Clear module cache
    Object.keys(require.cache)
      .filter(k => k.includes('server.js') || k.includes('memex-loader') ||
        k.includes('persistent-cache') || k.includes('safe-json') ||
        k.includes('agentbridge-client') || k.includes('event-consumer'))
      .forEach(k => delete require.cache[k]);

    const app = require('../scripts/server');
    server = app.listen(0, () => {
      baseUrl = `http://127.0.0.1:${server.address().port}`;
      done();
    });
  });

  after((_, done) => {
    server.closeAllConnections();
    server.close(done);
  });

  it('GET /api/agentbridge/status returns consumer state', async () => {
    const { status, json } = await fetch(`${baseUrl}/api/agentbridge/status`);
    assert.equal(status, 200);
    assert.equal(typeof json.bridge_connected, 'boolean');
    assert.ok(json.consumer);
    assert.equal(typeof json.consumer.running, 'boolean');
    assert.equal(typeof json.consumer.configured, 'boolean');
    assert.equal(typeof json.consumer.events_received, 'number');
    assert.equal(typeof json.consumer.events_processed, 'number');
    assert.equal(typeof json.consumer.errors, 'number');
  });

  it('POST /api/agentbridge/start returns status', async () => {
    const { status, json } = await postJSON(`${baseUrl}/api/agentbridge/start`, {});
    assert.equal(status, 200);
    assert.equal(typeof json.started, 'boolean');
    assert.ok(json.status);
  });

  it('POST /api/agentbridge/stop returns status', async () => {
    const { status, json } = await postJSON(`${baseUrl}/api/agentbridge/stop`, {});
    assert.equal(status, 200);
    assert.equal(json.stopped, true);
    assert.ok(json.status);
    assert.equal(json.status.running, false);
  });
});
