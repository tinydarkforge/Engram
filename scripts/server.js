#!/usr/bin/env node

/**
 * Engram HTTP Server
 *
 * Serves the Engram web dashboard and REST API.
 * Reuses existing Engram class for all data operations.
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
 *   node scripts/server.js                # Start on 127.0.0.1:3000
 *   PORT=8080 node scripts/server.js      # Custom port
 *   HOST=0.0.0.0 node scripts/server.js   # Expose on local network
 */

const express = require('express');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const { decode: msgpackDecode } = require('@msgpack/msgpack');
const Engram = require('./engram-loader');
const EventConsumer = require('./event-consumer');
const { resolveEngramPath } = require('./paths');
const ENGRAM_PATH = resolveEngramPath(__dirname);
const PORT = parseInt(process.env.PORT || '3000', 10);
const HOST = process.env.HOST || '127.0.0.1';

// Initialize Engram (lazy index load)
const engram = new Engram();

const app = express();
app.use(express.json());

app.use((_req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self' https://unpkg.com; style-src 'self' 'unsafe-inline'; img-src 'self' data:");
  next();
});

// Serve static web UI
app.use(express.static(path.join(__dirname, '..', 'web')));

// ─────────────────────────────────────────────────────────────
// Optional API key auth (set AGENTBRIDGE_API_KEY env var to enable)
// ─────────────────────────────────────────────────────────────
const AGENTBRIDGE_API_KEY = process.env.AGENTBRIDGE_API_KEY || '';

function requireApiKey(req, res, next) {
  if (!AGENTBRIDGE_API_KEY) return next();
  const auth = req.headers['authorization'] || '';
  if (auth === `Bearer ${AGENTBRIDGE_API_KEY}`) return next();
  res.status(401).json({ error: 'Unauthorized' });
}

// ─────────────────────────────────────────────────────────────
// Rate limiter (in-memory, no deps)
// ─────────────────────────────────────────────────────────────
const _rateLimitWindows = new Map();
var _rateLimitTimer = null;
function rateLimit(windowMs, max) {
  if (!_rateLimitTimer) {
    _rateLimitTimer = setInterval(function () {
      var now = Date.now();
      _rateLimitWindows.forEach(function (entry, key) {
        if (now - entry.start > windowMs) _rateLimitWindows.delete(key);
      });
    }, windowMs * 2);
    _rateLimitTimer.unref();
  }
  return (req, res, next) => {
    const key = req.socket?.remoteAddress || 'local';
    const now = Date.now();
    let entry = _rateLimitWindows.get(key);
    if (!entry || now - entry.start > windowMs) {
      entry = { start: now, count: 0 };
      _rateLimitWindows.set(key, entry);
    }
    entry.count += 1;
    if (entry.count > max) {
      return res.status(429).json({ error: 'Too many requests' });
    }
    next();
  };
}

// ─────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────

/** Sanitize project name to prevent path traversal. Returns empty string for invalid input. */
function sanitizeProject(name) {
  if (typeof name !== 'string' || !name.trim()) return '';
  return name.replace(/[^a-zA-Z0-9._-]/g, '');
}

/** Clamp a numeric limit to a safe range */
function clampLimit(value, defaultVal, max) {
  const n = parseInt(value, 10);
  if (!Number.isInteger(n) || n < 1) return defaultVal;
  return Math.min(n, max);
}

function ensureIndexLoaded() {
  if (!engram.index) {
    engram.loadIndex();
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
    const index = engram.index;
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
      } catch {
      res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * GET /api/projects
 * List all projects with session counts
 */
app.get('/api/projects', (req, res) => {
  try {
    const projects = Object.entries(engram.index.p || {}).map(([name, data]) => ({
      name,
      sessions: data.sc || 0,
      description: data.d || '',
      last_updated: data.u || 'unknown',
    }));

    res.json({
      total: projects.length,
      projects: projects.sort((a, b) => b.sessions - a.sessions),
    });
      } catch {
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
    if (!project) return res.status(400).json({ error: 'Invalid project name' });
    const limit = clampLimit(req.query.limit, 100, 500);

    const sessions = engram.listSessions(project);

    // Sort by date descending
    sessions.sort((a, b) => new Date(b.date) - new Date(a.date));

    res.json({
      project,
      total: sessions.length,
      sessions: sessions.slice(0, limit),
    });
      } catch {
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
    const index = engram.index;

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
      } catch {
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
    const project = req.query.project ? decodeURIComponent(req.query.project) : '';

    if (!query.trim()) {
      return res.json({ query: '', results: [], total: 0 });
    }

    const results = engram.search(query);
    results.results = results.results.slice(0, limit);
    if (project) {
      results.results = results.results.filter(r => r.project === project);
    }

    res.json(results);
      } catch {
      res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * POST /api/semantic-search
 * Semantic search by meaning (body: {query, limit, useDecay})
 */
app.post('/api/semantic-search', rateLimit(60_000, 30), async (req, res) => {
  try {
    const query = (req.body.query || '').slice(0, 500);
    const limit = clampLimit(req.body.limit, 10, 100);
    const useDecay = req.body.useDecay !== false;

    if (!query.trim()) {
      return res.json({ query: '', results: [], total: 0 });
    }

    const project = req.body.project || '';

    const results = await engram.semanticSearch(query, {
      limit,
      useDecay,
      minSimilarity: 0.15,
    });

    if (project) {
      results.results = results.results.filter(r => r.project === project);
    }

    res.json(results);
      } catch {
      res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * GET /api/graph
 * Concept graph formatted for vis.js (nodes + edges)
 */
app.get('/api/graph', (req, res) => {
  try {
    const graphPath = path.join(ENGRAM_PATH, '.neural', 'graph.msgpack');

    if (!fs.existsSync(graphPath)) {
      return res.json({ nodes: [], edges: [] });
    }

    const graph = msgpackDecode(fs.readFileSync(graphPath));

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
      const confidence = data.c || 0.8; // Use data confidence or default
      
      let color;
      if (sessions >= 5) color = '#10b981';       // premium emerald
      else if (sessions >= 2) color = '#34d399';   // soft emerald
      else color = '#1e1e22';                       // obsidian

      nodes.push({
        id: nodeId,
        label: name,
        value: sessions,
        color: {
          background: color,
          border: sessions >= 5 ? '#34d399' : '#2a2a2e',
          highlight: { background: '#10b981', border: '#ffffff' }
        },
        shadow: {
          enabled: true,
          color: color === '#10b981' ? 'rgba(16, 185, 129, 0.4)' : 'rgba(0,0,0,0.2)',
          size: sessions >= 5 ? 15 : 5
        },
        title: `${name}: ${sessions} session${sessions !== 1 ? 's' : ''} (${Math.round(confidence * 100)}% confidence)`,
      });
    }

    // Create edges
    for (const [source, targets] of Object.entries(graph.edges || {})) {
      if (!idMap[source]) continue;

      for (const edge of targets) {
        const target = edge.c || edge.target;
        if (!idMap[target]) continue;

        const isTension = edge.t || false;

        edges.push({
          from: idMap[source],
          to: idMap[target],
          value: edge.w || 1,
          color: isTension ? '#ef4444' : '#1e1e22',
          width: isTension ? 2 : 1,
          dashes: isTension ? [5, 5] : false,
        });
      }
    }

      res.json({ nodes, edges });
    } catch {
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  /** Open (or return cached) ledger DB. Returns null if DB file does not exist. */
let _ledgerDb = null;
function getLedgerDb() {
  if (_ledgerDb) return _ledgerDb;
  const fs = require('fs');
  const dbPath = path.join(ENGRAM_PATH, '.cache', 'engram.db');
  if (!fs.existsSync(dbPath)) return null;
  // Reuse the ledger's connection (WAL + busy_timeout already set)
  const ledger = require('./ledger');
  _ledgerDb = ledger.getDb();
  return _ledgerDb;
}

/**
 * GET /api/assertions?q=&status=&plane=&page=1&limit=50
 * Browse assertions stored in the ledger SQLite DB.
 */
app.get('/api/assertions', (req, res) => {
  try {
    const db = getLedgerDb();
    if (!db) {
      return res.json({ total: 0, page: 1, limit: 50, assertions: [] });
    }
    const q = (req.query.q || '').slice(0, 500).trim();
    const status = (req.query.status || '').trim();
    const plane = (req.query.plane || '').trim();
    const limit = clampLimit(req.query.limit, 50, 200);
    const page = Math.max(1, parseInt(req.query.page || '1', 10));
    const offset = (page - 1) * limit;

    const conditions = [];
    const params = [];

    if (q) {
      conditions.push('claim LIKE ?');
      params.push(`%${q}%`);
    }
    if (status) {
      conditions.push('status = ?');
      params.push(status);
    }
    if (plane) {
      conditions.push('plane = ?');
      params.push(plane);
    }

    const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

    const totalRow = db.prepare(`SELECT COUNT(*) AS n FROM assertions ${where}`).get(...params);
    const total = totalRow ? totalRow.n : 0;

    const assertions = db.prepare(
      `SELECT id, claim, body, status, confidence, plane, class, density_hint, created_at, last_verified
       FROM assertions ${where}
       ORDER BY created_at DESC
       LIMIT ? OFFSET ?`
    ).all(...params, limit, offset);

    res.json({ total, page, limit, assertions });
  } catch (e) {
    if (e.message && e.message.includes('no such table')) {
      return res.json({ total: 0, page: 1, limit: 50, assertions: [] });
    }
    res.status(500).json({ error: 'Internal server error' });
  }
});


/**
 * GET /api/assertions/:id
 * Full assertion detail with lineage, outcome history, and selection stats.
 */
app.get('/api/assertions/:id', (req, res) => {
  try {
    const db = getLedgerDb();
    if (!db) {
      return res.status(404).json({ error: 'not found' });
    }

    const id = req.params.id;
    let assertion;
    try {
      assertion = db.prepare(
        `SELECT id, plane, class, claim, body, confidence, status, density_hint,
                staleness_model, quorum_count, created_at, last_verified, cache_stable
         FROM assertions WHERE id = ?`
      ).get(id);
    } catch (e) {
      if (e.message && e.message.includes('no such table')) {
        return res.status(404).json({ error: 'not found' });
      }
      throw e;
    }

    if (!assertion) {
      return res.status(404).json({ error: 'not found' });
    }

    let lineage = [];
    try {
      lineage = db.prepare(
        `SELECT source_span FROM assertion_lineage WHERE assertion_id = ?`
      ).all(id).map(r => r.source_span);
    } catch (e) {
      if (!e.message || !e.message.includes('no such table')) throw e;
    }

    let outcomes = [];
    try {
      outcomes = db.prepare(
        `SELECT session_id, scored_at, signal_source, score, note
         FROM assertion_outcomes WHERE assertion_id = ?
         ORDER BY scored_at DESC LIMIT 100`
      ).all(id);
    } catch (e) {
      if (!e.message || !e.message.includes('no such table')) throw e;
    }

    let selection_count = 0;
    let avg_score = null;
    try {
      const selRow = db.prepare(
        `SELECT COUNT(*) AS cnt FROM selection_log WHERE assertion_id = ?`
      ).get(id);
      selection_count = selRow ? selRow.cnt : 0;

      const scoreRow = db.prepare(
        `SELECT AVG(score) AS avg FROM assertion_outcomes WHERE assertion_id = ?`
      ).get(id);
      avg_score = scoreRow && scoreRow.avg != null ? scoreRow.avg : null;
    } catch (e) {
      if (!e.message || !e.message.includes('no such table')) throw e;
    }

        res.json({ ...assertion, lineage, outcomes, selection_count, avg_score });
      } catch {
        res.status(500).json({ error: 'Internal server error' });
      }
    });

/**
 * GET /api/sessions/:project/:sessionId
 * Session detail: basic fields from sessions-index.json + ledger stats.
 */
app.get('/api/sessions/:project/:sessionId', (req, res) => {
  try {
    const project = sanitizeProject(req.params.project);
    if (!project) return res.status(400).json({ error: 'Invalid project name' });
    const sessionId = req.params.sessionId;

    const sessions = engram.listSessions(project);
    const session = sessions.find(s => s.id === sessionId);
    if (!session) {
      return res.status(404).json({ error: 'not found' });
    }

    let assertions_selected = 0;
    let outcomes = [];
    const db = getLedgerDb();
    if (db) {
      try {
        const selRow = db.prepare(
          `SELECT COUNT(*) AS cnt FROM selection_log WHERE session_id = ?`
        ).get(sessionId);
        assertions_selected = selRow ? selRow.cnt : 0;
      } catch (e) {
        if (!e.message || !e.message.includes('no such table')) throw e;
      }

      try {
        outcomes = db.prepare(
          `SELECT assertion_id, signal_source, score
           FROM assertion_outcomes WHERE session_id = ?
           ORDER BY scored_at DESC LIMIT 100`
        ).all(sessionId);
      } catch (e) {
        if (!e.message || !e.message.includes('no such table')) throw e;
      }
    }

    res.json({
      id: session.id,
      project: session.project || project,
      date: session.date,
      summary: session.summary,
      topics: session.topics || [],
      assertions_selected,
      outcomes,
    });
      } catch {
      res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * POST /api/feedback
 * Layer C user feedback signal.
 * Body: { sessionId, assertionId, signal: 'helpful'|'unhelpful'|'wrong', note? }
 */
app.post('/api/feedback', requireApiKey, (req, res) => {
  try {
    const { sessionId, assertionId, signal, note } = req.body || {};

    if (!sessionId || typeof sessionId !== 'string') {
      return res.status(400).json({ error: 'sessionId is required' });
    }
    if (!assertionId || typeof assertionId !== 'string') {
      return res.status(400).json({ error: 'assertionId is required' });
    }
    if (!['helpful', 'unhelpful', 'wrong'].includes(signal)) {
      return res.status(400).json({ error: 'signal must be helpful, unhelpful, or wrong' });
    }

    const score = signal === 'helpful' ? 1.0 : signal === 'unhelpful' ? 0.2 : 0.0;
    const id = `uf_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`;
    const now = new Date().toISOString();

    const db = getLedgerDb();
    if (!db) {
      return res.status(400).json({ error: 'ledger database not initialized' });
    }

    db.prepare(
      `INSERT OR REPLACE INTO assertion_outcomes
         (id, assertion_id, session_id, selected_at, scored_at, signal_source, score, note, reply_hash)
       VALUES (?, ?, ?, ?, ?, 'user', ?, ?, NULL)`
    ).run(id, assertionId, sessionId, now, now, score, note || null);

    res.json({ ok: true, scored: 1 });
  } catch (e) {
    if (e.message && (e.message.includes('no such table') || e.message.includes('FOREIGN KEY'))) {
      return res.status(400).json({ error: 'assertion not found or schema not migrated' });
    }
    res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * GET /api/dashboard/tensions
 * Live tension radar data — unresolved tensions with detected_at
 */
app.get('/api/dashboard/tensions', (req, res) => {
  try {
    const db = getLedgerDb();
    if (!db) return res.json({ tensions: [], total: 0 });
    const tensions = db.prepare(`
      SELECT tp.a_id, tp.b_id, tp.detected_at,
             a.claim AS a_claim, b.claim AS b_claim,
             a.plane AS a_plane
      FROM tension_pairs tp
      LEFT JOIN assertions a ON a.id = tp.a_id
      LEFT JOIN assertions b ON b.id = tp.b_id
      WHERE tp.resolved_at IS NULL
      ORDER BY tp.detected_at DESC
      LIMIT 50
    `).all();
    res.json({ tensions, total: tensions.length });
  } catch (e) {
    if (e.message && e.message.includes('no such table')) {
      return res.json({ tensions: [], total: 0 });
    }
    res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * GET /api/dashboard/velocity
 * Learning velocity — facts/day over time from assertion_outcomes
 */
app.get('/api/dashboard/velocity', (req, res) => {
  try {
    const db = getLedgerDb();
    if (!db) return res.json({ rate: 0, history: [], total_facts: 0 });
    const totalFacts = db.prepare('SELECT COUNT(*) AS n FROM assertions').get().n || 0;
    const oldest = db.prepare('SELECT MIN(created_at) AS oldest FROM assertions').get();
    if (!oldest || !oldest.oldest) {
      return res.json({ rate: 0, history: [], total_facts: totalFacts });
    }
    const daysSince = Math.max(1, (Date.now() - new Date(oldest.oldest).getTime()) / (1000 * 60 * 60 * 24));
    const rate = +(totalFacts / daysSince).toFixed(1);

    const history = db.prepare(`
      SELECT DATE(created_at) AS day, COUNT(*) AS count
      FROM assertions
      WHERE created_at >= datetime('now', '-30 days')
      GROUP BY DATE(created_at)
      ORDER BY day ASC
    `).all();

    res.json({ rate, history, total_facts: totalFacts });
  } catch (e) {
    if (e.message && e.message.includes('no such table')) {
      return res.json({ rate: 0, history: [], total_facts: 0 });
    }
    res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * GET /api/dashboard/consolidation
 * Consolidation status — last run time, tasks
 */
app.get('/api/dashboard/consolidation', (req, res) => {
  try {
    const fs = require('fs');
    const statsPath = path.join(ENGRAM_PATH, '.cache', 'consolidation.json');
    if (fs.existsSync(statsPath)) {
      const stats = JSON.parse(fs.readFileSync(statsPath, 'utf8'));
      return res.json(stats);
    }
    res.json({ last_run_at: null, tasks_run: [] });
  } catch {
    res.json({ last_run_at: null, tasks_run: [] });
  }
});

// ─────────────────────────────────────────────────────────────
// AgentBridge Event Consumer
// ─────────────────────────────────────────────────────────────

const consumer = new EventConsumer({
  engram,
  bridge: engram._bridge,
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
      const bridge = await engram._bridge;
      bridgeConnected = bridge.isConnected();
    } catch { /* ignore */ }

    res.json({
      bridge_connected: bridgeConnected,
      bridge_configured: !!process.env.AGENTBRIDGE_URL,
      consumer: consumerStatus,
    });
      } catch {
      res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * POST /api/agentbridge/start
 * Start event polling
 */
app.post('/api/agentbridge/start', requireApiKey, (req, res) => {
  try {
    const started = consumer.start();
    res.json({ started, status: consumer.getStatus() });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

/**
 * POST /api/agentbridge/stop
 * Stop event polling
 */
app.post('/api/agentbridge/stop', requireApiKey, (req, res) => {
  consumer.stop();
  res.json({ stopped: true, status: consumer.getStatus() });
});

// ─────────────────────────────────────────────────────────────
// Health Check
// ─────────────────────────────────────────────────────────────

function healthResponse(status) {
  return {
    status: status,
    uptime: Math.floor(process.uptime()),
    version: engram.index?.v || 'unknown',
    timestamp: new Date().toISOString(),
  };
}

app.get('/api/health', (req, res) => {
  try {
    ensureIndexLoaded();
    res.json(healthResponse('healthy'));
  } catch {
    res.status(503).json(healthResponse('unhealthy'));
  }
});

app.get('/health', (req, res) => {
  try {
    ensureIndexLoaded();
    res.status(200).json(healthResponse('healthy'));
  } catch {
    res.status(503).json(healthResponse('unhealthy'));
  }
});

// ─────────────────────────────────────────────────────────────
// Global error handler
// ─────────────────────────────────────────────────────────────

app.use(function (err, req, res, next) {
  void req;
  void next;
  console.error('Unhandled error:', err.message || err);
  res.status(500).json({ error: err.message || 'Internal server error' });
});

// ─────────────────────────────────────────────────────────────
// Start
// ─────────────────────────────────────────────────────────────

if (require.main === module) {
  const server = app.listen(PORT, HOST, () => {
    const displayHost = HOST === '0.0.0.0' ? 'localhost' : HOST;
    if (HOST !== '127.0.0.1' && HOST !== 'localhost') {
      console.warn(`WARNING: Dashboard server bound to ${HOST} with no authentication. Do not expose to untrusted networks.`);
    }
    console.log(`Engram server listening on http://${displayHost}:${PORT}`);
    console.log(`  Bound host: ${HOST}`);
    console.log(`  Dashboard: http://${displayHost}:${PORT}/`);
    console.log(`  API:       http://${displayHost}:${PORT}/api/stats`);
    console.log(`  Health:    http://${displayHost}:${PORT}/health`);
  });

  // Graceful shutdown
  function shutdown(signal) {
    console.log(`\n${signal} received, shutting down...`);
    consumer.stop();
    server.close(() => {
      try { engram.persistentCache.close(); } catch { /* already closed */ }
      try { if (_ledgerDb) _ledgerDb.close(); } catch { /* already closed */ }
      console.log('Shutdown complete');
      process.exit(0);
    });
    // Force exit after 10s
    setTimeout(() => process.exit(0), 10000).unref();
  }

  // Start background consolidation
  let consolidationTimer = null;
  try {
    const { consolidate } = require('./consolidate');
    consolidate({ bloom: false, manifest: false, ledger_scan: true, ledger_verify: true, counterfactual: true, post_hoc: true, auto_resolve: true }).catch(() => {});
    consolidationTimer = setInterval(() => {
      consolidate({ bloom: false, manifest: false, ledger_scan: true, ledger_verify: true, counterfactual: true, post_hoc: true, auto_resolve: true }).catch(() => {});
    }, 300000);
    consolidationTimer.unref();
  } catch (e) {
    console.warn('Consolidation not available:', e.message);
  }

  process.on('SIGTERM', () => {
    if (consolidationTimer) clearInterval(consolidationTimer);
    shutdown('SIGTERM');
  });
  process.on('SIGINT', () => {
    if (consolidationTimer) clearInterval(consolidationTimer);
    shutdown('SIGINT');
  });
}

module.exports = app;
