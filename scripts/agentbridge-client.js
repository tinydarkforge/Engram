#!/usr/bin/env node

/**
 * AgentBridge Client for Engram
 *
 * Thin HTTP client that connects Engram to AgentBridge for inter-agent
 * communication. Opt-in via AGENTBRIDGE_URL env var — when unset,
 * everything degrades to no-ops.
 *
 * Uses only Node.js built-in http/https modules (no new npm deps).
 */

const http = require('http');
const https = require('https');

const AGENT_ID = 'engram';
const AGENT_NAME = 'Engram Knowledge Base';
const HTTP_TIMEOUT = 3000; // 3s fire-and-forget

const EVENT_SCHEMAS = [
  {
    event_type: 'engram.session.saved',
    description: 'A session was saved to Engram',
    required_fields: ['session_id', 'project', 'summary'],
  },
  {
    event_type: 'engram.query.requested',
    description: 'A query was made against Engram',
    required_fields: ['query', 'requester'],
  },
  {
    event_type: 'engram.query.result',
    description: 'A query returned results from Engram',
    required_fields: ['query', 'source'],
  },
];

/**
 * Create a stub client with the same interface (all no-ops).
 * Used when AgentBridge is unavailable or disabled.
 */
function createStub() {
  return {
    emit: () => Promise.resolve({ sent: false }),
    heartbeat: () => Promise.resolve({ sent: false }),
    isConnected: () => false,
  };
}

/**
 * Make an HTTP(S) request, returning parsed JSON body.
 */
function request(url, method, body, token) {
  return new Promise((resolve, reject) => {
    const parsed = new URL(url);
    const transport = parsed.protocol === 'https:' ? https : http;

    const headers = { 'Content-Type': 'application/json' };
    if (token) headers['Authorization'] = `Bearer ${token}`;

    const payload = body ? JSON.stringify(body) : null;
    if (payload) headers['Content-Length'] = Buffer.byteLength(payload);

    const req = transport.request(
      {
        hostname: parsed.hostname,
        port: parsed.port,
        path: parsed.pathname + parsed.search,
        method,
        headers,
        timeout: HTTP_TIMEOUT,
        agent: false,
      },
      (res) => {
        let data = '';
        res.on('data', (chunk) => (data += chunk));
        res.on('end', () => {
          try {
            resolve({ status: res.statusCode, body: data ? JSON.parse(data) : null });
          } catch {
            resolve({ status: res.statusCode, body: data });
          }
        });
      }
    );

    req.on('timeout', () => {
      req.destroy();
      reject(new Error('Request timed out'));
    });
    req.on('error', reject);

    if (payload) req.write(payload);
    req.end();
  });
}

/**
 * Connect to AgentBridge, register agent and event schemas.
 * Returns a client object or a stub if connection fails.
 */
async function connect(options = {}) {
  const baseUrl = options.url || process.env.AGENTBRIDGE_URL;
  const token = options.token || process.env.AGENTBRIDGE_TOKEN;

  if (!baseUrl) {
    return createStub();
  }

  try {
    // Health check
    await request(`${baseUrl}/health`, 'GET', null, token);

    // Register as agent
    await request(`${baseUrl}/agents`, 'POST', {
      agent_id: AGENT_ID,
      name: AGENT_NAME,
      capabilities: ['memory', 'search', 'semantic-search'],
    }, token);

    // Register event schemas
    for (const schema of EVENT_SCHEMAS) {
      await request(`${baseUrl}/bus/schemas`, 'POST', schema, token);
    }

    let connected = true;

    return {
      emit: (eventType, metadata) => {
        return request(`${baseUrl}/bus/events`, 'POST', {
          event_type: eventType,
          agent_id: AGENT_ID,
          timestamp: new Date().toISOString(),
          metadata,
        }, token)
          .then(() => ({ sent: true }))
          .catch(() => ({ sent: false }));
      },

      heartbeat: (status = 'healthy') => {
        return request(`${baseUrl}/agents/${AGENT_ID}/heartbeat`, 'POST', {
          status,
          timestamp: new Date().toISOString(),
        }, token)
          .then(() => ({ sent: true }))
          .catch(() => ({ sent: false }));
      },

      isConnected: () => connected,
    };
  } catch {
    return createStub();
  }
}

module.exports = { connect, createStub, request, AGENT_ID };
