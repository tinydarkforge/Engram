#!/usr/bin/env node

const { describe, it, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const http = require('http');

// Clear cached modules so we get fresh instances
const keysToDelete = Object.keys(require.cache).filter(k =>
  k.includes('event-consumer') || k.includes('agentbridge-client')
);
keysToDelete.forEach(k => delete require.cache[k]);

const EventConsumer = require('../scripts/event-consumer');

describe('EventConsumer', () => {
  describe('without AgentBridge', () => {
    it('start() returns false when no URL configured', () => {
      const consumer = new EventConsumer();
      assert.equal(consumer.start(), false);
      assert.equal(consumer.getStatus().running, false);
    });

    it('getStatus() returns configured: false', () => {
      const consumer = new EventConsumer();
      const status = consumer.getStatus();
      assert.equal(status.configured, false);
      assert.equal(status.running, false);
      assert.equal(status.events_received, 0);
    });

    it('stop() is safe to call when not running', () => {
      const consumer = new EventConsumer();
      consumer.stop(); // should not throw
      assert.equal(consumer.getStatus().running, false);
    });
  });

  describe('with mock AgentBridge', () => {
    let mockServer;
    let mockPort;
    let receivedRequests;

    before((_, done) => {
      receivedRequests = [];
      mockServer = http.createServer((req, res) => {
        let body = '';
        req.on('data', chunk => { body += chunk; });
        req.on('end', () => {
          receivedRequests.push({
            method: req.method,
            url: req.url,
            body: body ? JSON.parse(body) : null,
          });

          // Return events for poll requests
          if (req.url.includes('/bus/events') && req.method === 'GET') {
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify([
              {
                id: 'evt-001',
                event_type: 'memex.query.requested',
                timestamp: new Date().toISOString(),
                metadata: {
                  query: 'test search',
                  requester: 'test-agent',
                  mode: 'keyword',
                },
              },
            ]));
            return;
          }

          // Default: emit endpoint
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ ok: true }));
        });
      });

      mockServer.listen(0, () => {
        mockPort = mockServer.address().port;
        done();
      });
    });

    after((_, done) => {
      mockServer.close(done);
    });

    beforeEach(() => {
      receivedRequests = [];
    });

    it('start() returns true when URL is configured', () => {
      const consumer = new EventConsumer({
        url: `http://127.0.0.1:${mockPort}`,
        pollInterval: 60000, // long interval so it doesn't auto-poll again
      });
      const started = consumer.start();
      assert.equal(started, true);
      assert.equal(consumer.getStatus().running, true);
      consumer.stop();
    });

    it('polls for events and processes them', async () => {
      // Create a mock memex with search method
      const mockMemex = {
        search: (query) => ({
          query,
          results: [{ type: 'topic', topic: 'test' }],
          total: 1,
        }),
      };

      // Create a mock bridge
      const emittedEvents = [];
      const mockBridge = {
        emit: (type, meta) => {
          emittedEvents.push({ type, meta });
          return Promise.resolve({ sent: true });
        },
      };

      const consumer = new EventConsumer({
        url: `http://127.0.0.1:${mockPort}`,
        pollInterval: 60000,
        memex: mockMemex,
        bridge: mockBridge,
      });

      // Manually trigger a poll cycle
      await consumer._poll();
      consumer.stop();

      // Should have polled the mock server
      const pollReq = receivedRequests.find(r => r.url.includes('/bus/events'));
      assert.ok(pollReq, 'Should have polled for events');
      assert.equal(pollReq.method, 'GET');

      // Should have processed the event
      assert.equal(consumer.stats.events_received, 1);
      assert.equal(consumer.stats.events_processed, 1);

      // Should have emitted a result
      assert.equal(emittedEvents.length, 1);
      assert.equal(emittedEvents[0].type, 'memex.query.result');
      assert.equal(emittedEvents[0].meta.query, 'test search');
      assert.equal(emittedEvents[0].meta.source, 'keyword');
      assert.equal(emittedEvents[0].meta.requester, 'test-agent');
    });

    it('deduplicates events by id', async () => {
      const mockMemex = {
        search: () => ({ results: [], total: 0 }),
      };

      const consumer = new EventConsumer({
        url: `http://127.0.0.1:${mockPort}`,
        pollInterval: 60000,
        memex: mockMemex,
        bridge: { emit: () => Promise.resolve({ sent: true }) },
      });

      // Poll twice — same event id should only be processed once
      await consumer._poll();
      await consumer._poll();
      consumer.stop();

      assert.equal(consumer.stats.events_received, 1);
    });

    it('handles bridge as a promise', async () => {
      const emittedEvents = [];
      const bridgePromise = Promise.resolve({
        emit: (type, meta) => {
          emittedEvents.push({ type, meta });
          return Promise.resolve({ sent: true });
        },
      });

      const consumer = new EventConsumer({
        url: `http://127.0.0.1:${mockPort}`,
        pollInterval: 60000,
        memex: { search: () => ({ results: [], total: 0 }) },
        bridge: bridgePromise,
      });

      await consumer._poll();
      consumer.stop();

      assert.equal(emittedEvents.length, 1);
    });

    it('increments error count on missing memex', async () => {
      const consumer = new EventConsumer({
        url: `http://127.0.0.1:${mockPort}`,
        pollInterval: 60000,
        memex: null, // no memex instance
      });

      await consumer._poll();
      consumer.stop();

      assert.equal(consumer.stats.errors, 1);
    });

    it('getStatus() reflects running state and stats', async () => {
      const consumer = new EventConsumer({
        url: `http://127.0.0.1:${mockPort}`,
        pollInterval: 60000,
        memex: { search: () => ({ results: [], total: 0 }) },
        bridge: { emit: () => Promise.resolve({ sent: true }) },
      });

      consumer.start();
      // Wait a tick for first poll
      await new Promise(r => setTimeout(r, 50));
      const status = consumer.getStatus();
      consumer.stop();

      assert.equal(status.running, true);
      assert.equal(status.configured, true);
      assert.ok(status.started_at);
      assert.ok(status.last_poll);
    });
  });
});
