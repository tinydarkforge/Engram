#!/usr/bin/env node

/**
 * Memex HTTP Server
 *
 * Serves the Memex web dashboard and REST API.
 * Reuses existing Memex class for all data operations.
 *
 * Endpoints:
 *   GET  /api/stats              - Dashboard overview stats
 *   GET  /api/projects           - List all projects
 *   GET  /api/sessions/:project  - Sessions for a project (?limit=N)
 *   GET  /api/topics             - Top topics
 *   GET  /api/search?q=&limit=   - Keyword search
 *   POST /api/semantic-search    - Semantic search (body: {query, limit, useDecay})
 *   GET  /api/graph              - Concept graph for vis.js
 *
 * Usage:
 *   node scripts/server.js                # Start on default port 3000
 *   PORT=8080 node scripts/server.js      # Custom port
 */

const express = require('express');
const path = require('path');
const fs = require('fs');
const msgpack = require('msgpack-lite');
const Memex = require('./memex-loader');
const EventConsumer = require('./event-consumer');
const { resolveMemexPath } = require('./paths');
const { readJSON } = require('./safe-json');

const MEMEX_PATH = resolveMemexPath(__dirname);
const PORT = parseInt(process.env.PORT || '3000', 10);

// Initialize Memex (lazy index load)
const memex = new Memex();

const app = express();
app.use(express.json());

// Serve static web UI
app.use(express.static(path.join(__dirname, '..', 'web')));

// ─────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────

/** Sanitize project name to prevent path traversal */
function sanitizeProject(name) {
  return name.replace(/[^a-zA-Z0-9._-]/g, '');
}

/** Clamp a numeric limit to a safe range */
function clampLimit(value, defaultVal, max) {
  const n = parseInt(value || String(defaultVal), 10);
  if (isNaN(n) || n < 1) return defaultVal;
  return Math.min(n, max);
}

function ensureIndexLoaded() {
  if (!memex.index) {
    memex.loadIndex();
  }
}

// ─────────────────────────────────────────────────────────────
// API Routes
// ─────────────────────────────────────────────────────────────

app.use('/api', (req, res, next) => {
  if (req.path.startsWith('/agentbridge')) {
    return next();
  }
  try {
    ensureIndexLoaded();
    next();
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

/**
 * GET /api/stats
 * Dashboard overview: totalSessions, projects list, totalTopics
 */
app.get('/api/stats', (req, res) => {
  try {
    const index = memex.index;
    const projects = Object.entries(index.p || {}).map(([name, data]) => ({
      name,
      sessions: data.sc || 0,
      last_updated: data.u || 'unknown',
    }));

    const totalTopics = Object.keys(index.t || {}).length;

    res.json({
      totalSessions: index.m?.ts || 0,
      projects,
      totalTopics,
      version: index.v,
      lastUpdated: index.u,
    });
  } catch (e) {
    res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * GET /api/projects
 * List all projects with session counts
 */
app.get('/api/projects', (req, res) => {
  try {
    const projects = Object.entries(memex.index.p || {}).map(([name, data]) => ({
      name,
      sessions: data.sc || 0,
      description: data.d || '',
      last_updated: data.u || 'unknown',
    }));

    res.json({
      total: projects.length,
      projects: projects.sort((a, b) => b.sessions - a.sessions),
    });
  } catch (e) {
    res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * GET /api/sessions/:project
 * List sessions for a project (lightweight: id, date, summary, topics)
 */
app.get('/api/sessions/:project', (req, res) => {
  try {
    const project = sanitizeProject(req.params.project);
    const limit = clampLimit(req.query.limit, 100, 500);

    const sessions = memex.listSessions(project);

    // Sort by date descending
    sessions.sort((a, b) => new Date(b.date) - new Date(a.date));

    res.json({
      project,
      total: sessions.length,
      sessions: sessions.slice(0, limit),
    });
  } catch (e) {
    res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * GET /api/topics
 * Top topics with session counts
 */
app.get('/api/topics', (req, res) => {
  try {
    const limit = clampLimit(req.query.limit, 30, 200);
    const index = memex.index;

    const topics = Object.entries(index.t || {})
      .filter(([name]) => name)
      .map(([name, data]) => ({
        name,
        sessions: data.sc || 0,
        projects: data.p || [],
      }))
      .sort((a, b) => b.sessions - a.sessions)
      .slice(0, limit);

    res.json({
      total: Object.keys(index.t || {}).length,
      topics,
    });
  } catch (e) {
    res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * GET /api/search?q=&limit=
 * Keyword search across all projects
 */
app.get('/api/search', (req, res) => {
  try {
    const query = (req.query.q || '').slice(0, 500);
    const limit = clampLimit(req.query.limit, 20, 100);

    if (!query.trim()) {
      return res.json({ query: '', results: [], total: 0 });
    }

    const results = memex.search(query);
    results.results = results.results.slice(0, limit);

    res.json(results);
  } catch (e) {
    res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * POST /api/semantic-search
 * Semantic search by meaning (body: {query, limit, useDecay})
 */
app.post('/api/semantic-search', async (req, res) => {
  try {
    const query = (req.body.query || '').slice(0, 500);
    const limit = clampLimit(req.body.limit, 10, 100);
    const useDecay = req.body.useDecay !== false;

    if (!query.trim()) {
      return res.json({ query: '', results: [], total: 0 });
    }

    const results = await memex.semanticSearch(query, {
      limit,
      useDecay,
      minSimilarity: 0.15,
    });

    res.json(results);
  } catch (e) {
    res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * GET /api/graph
 * Concept graph formatted for vis.js (nodes + edges)
 */
app.get('/api/graph', (req, res) => {
  try {
    const graphPath = path.join(MEMEX_PATH, '.neural', 'graph.msgpack');

    if (!fs.existsSync(graphPath)) {
      return res.json({ nodes: [], edges: [] });
    }

    const graph = msgpack.decode(fs.readFileSync(graphPath));

    // Transform to vis.js format
    const nodes = [];
    const edges = [];
    let nodeId = 0;
    const idMap = {};

    // Create nodes
    for (const [name, data] of Object.entries(graph.nodes || {})) {
      nodeId++;
      idMap[name] = nodeId;

      const sessions = data.w || 1;
      let color;
      if (sessions >= 5) color = '#f85149';       // hot
      else if (sessions >= 3) color = '#d29922';   // warm
      else if (sessions >= 2) color = '#58a6ff';   // normal
      else color = '#8b949e';                       // cold

      nodes.push({
        id: nodeId,
        label: name,
        value: sessions,
        color: { background: color, border: color },
        title: `${name}: ${sessions} session${sessions !== 1 ? 's' : ''}`,
      });
    }

    // Create edges
    for (const [source, targets] of Object.entries(graph.edges || {})) {
      if (!idMap[source]) continue;

      for (const edge of targets) {
        const target = edge.c || edge.target;
        if (!idMap[target]) continue;

        edges.push({
          from: idMap[source],
          to: idMap[target],
          value: edge.w || 1,
        });
      }
    }

    res.json({ nodes, edges });
  } catch (e) {
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ─────────────────────────────────────────────────────────────
// AgentBridge Event Consumer
// ─────────────────────────────────────────────────────────────

const consumer = new EventConsumer({
  memex,
  bridge: memex._bridge,
});

// Auto-start if AgentBridge is configured
consumer.start();

/**
 * GET /api/agentbridge/status
 * Show event consumer status and AgentBridge connection info
 */
app.get('/api/agentbridge/status', async (req, res) => {
  try {
    const consumerStatus = consumer.getStatus();

    let bridgeConnected = false;
    try {
      const bridge = await memex._bridge;
      bridgeConnected = bridge.isConnected();
    } catch { /* ignore */ }

    res.json({
      bridge_connected: bridgeConnected,
      bridge_url: process.env.AGENTBRIDGE_URL || null,
      consumer: consumerStatus,
    });
  } catch (e) {
    res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * POST /api/agentbridge/start
 * Start event polling
 */
app.post('/api/agentbridge/start', (req, res) => {
  const started = consumer.start();
  res.json({ started, status: consumer.getStatus() });
});

/**
 * POST /api/agentbridge/stop
 * Stop event polling
 */
app.post('/api/agentbridge/stop', (req, res) => {
  consumer.stop();
  res.json({ stopped: true, status: consumer.getStatus() });
});

// ─────────────────────────────────────────────────────────────
// Health Check
// ─────────────────────────────────────────────────────────────

app.get('/health', (req, res) => {
  const healthy = !!memex.index;
  res.status(healthy ? 200 : 503).json({
    status: healthy ? 'healthy' : 'unhealthy',
    uptime: Math.floor(process.uptime()),
    version: memex.index?.v || 'unknown',
    timestamp: new Date().toISOString(),
  });
});

// ─────────────────────────────────────────────────────────────
// Start
// ─────────────────────────────────────────────────────────────

if (require.main === module) {
  const server = app.listen(PORT, () => {
    console.log(`Memex server listening on http://localhost:${PORT}`);
    console.log(`  Dashboard: http://localhost:${PORT}/`);
    console.log(`  API:       http://localhost:${PORT}/api/stats`);
    console.log(`  Health:    http://localhost:${PORT}/health`);
  });

  // Graceful shutdown
  function shutdown(signal) {
    console.log(`\n${signal} received, shutting down...`);
    consumer.stop();
    server.close(() => {
      try { memex.persistentCache.close(); } catch { /* already closed */ }
      console.log('Shutdown complete');
      process.exit(0);
    });
    // Force exit after 10s
    setTimeout(() => process.exit(1), 10000).unref();
  }

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
}

module.exports = app;
