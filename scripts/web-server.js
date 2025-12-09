#!/usr/bin/env node

/**
 * Memex Web UI Server
 *
 * Usage:
 *   node web-server.js              Start on port 3333
 *   node web-server.js --port 8080  Custom port
 */

const express = require('express');
const path = require('path');
const fs = require('fs');

const MEMEX_PATH = process.env.MEMEX_PATH || path.join(process.env.HOME, 'code/cirrus/DevOps/Memex');
const WEB_PATH = path.join(MEMEX_PATH, 'web');
const DEFAULT_PORT = 3333;

// Parse args
const portArg = process.argv.indexOf('--port');
const PORT = portArg > -1 ? parseInt(process.argv[portArg + 1]) : DEFAULT_PORT;

const app = express();
app.use(express.json());

// Static files
app.use(express.static(WEB_PATH));

// ─────────────────────────────────────────────────────────────
// API Routes
// ─────────────────────────────────────────────────────────────

/**
 * GET /api/stats - System overview
 */
app.get('/api/stats', (req, res) => {
  try {
    const indexPath = path.join(MEMEX_PATH, 'index.json');
    const index = JSON.parse(fs.readFileSync(indexPath, 'utf8'));

    const projects = Object.entries(index.p || {}).map(([name, data]) => ({
      name,
      sessions: data.sc || 0,
      lastUpdated: data.u || 'unknown'
    }));

    const totalSessions = projects.reduce((sum, p) => sum + p.sessions, 0);
    const totalTopics = Object.keys(index.t || {}).length;

    res.json({
      version: index.v || '2.0',
      lastUpdated: index.u,
      projects,
      totalSessions,
      totalTopics
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

/**
 * GET /api/projects - List all projects
 */
app.get('/api/projects', (req, res) => {
  try {
    const projectsDir = path.join(MEMEX_PATH, 'summaries/projects');
    const projects = [];

    for (const proj of fs.readdirSync(projectsDir)) {
      const indexPath = path.join(projectsDir, proj, 'sessions-index.json');
      if (!fs.existsSync(indexPath)) continue;

      const data = JSON.parse(fs.readFileSync(indexPath, 'utf8'));
      projects.push({
        name: proj,
        sessions: data.total_sessions || 0,
        lastUpdated: data.last_updated || 'unknown',
        recentTopics: [...new Set(
          (data.sessions || [])
            .slice(0, 5)
            .flatMap(s => s.topics || [])
        )].slice(0, 10)
      });
    }

    res.json({ projects });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

/**
 * GET /api/sessions/:project - Get sessions for a project
 */
app.get('/api/sessions/:project', (req, res) => {
  try {
    const { project } = req.params;
    const { limit = 50, offset = 0 } = req.query;

    const indexPath = path.join(MEMEX_PATH, 'summaries/projects', project, 'sessions-index.json');
    if (!fs.existsSync(indexPath)) {
      return res.status(404).json({ error: 'Project not found' });
    }

    const data = JSON.parse(fs.readFileSync(indexPath, 'utf8'));
    const sessions = (data.sessions || [])
      .slice(parseInt(offset), parseInt(offset) + parseInt(limit))
      .map(s => ({
        id: s.id,
        date: s.date,
        summary: s.summary,
        topics: s.topics || []
      }));

    res.json({
      project,
      total: data.total_sessions || 0,
      sessions
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

/**
 * GET /api/search - Keyword search across all sessions
 */
app.get('/api/search', (req, res) => {
  try {
    const { q, limit = 20 } = req.query;
    if (!q) return res.json({ results: [] });

    const query = q.toLowerCase();
    const results = [];
    const projectsDir = path.join(MEMEX_PATH, 'summaries/projects');

    for (const proj of fs.readdirSync(projectsDir)) {
      const indexPath = path.join(projectsDir, proj, 'sessions-index.json');
      if (!fs.existsSync(indexPath)) continue;

      const data = JSON.parse(fs.readFileSync(indexPath, 'utf8'));
      for (const s of data.sessions || []) {
        const text = [s.summary, ...(s.topics || [])].join(' ').toLowerCase();
        if (text.includes(query)) {
          results.push({
            project: proj,
            id: s.id,
            date: s.date,
            summary: s.summary,
            topics: s.topics || [],
            match: 'keyword'
          });
        }
      }
    }

    res.json({
      query: q,
      results: results.slice(0, parseInt(limit)),
      total: results.length
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

/**
 * POST /api/semantic-search - Semantic search using embeddings
 */
app.post('/api/semantic-search', async (req, res) => {
  try {
    const { query, limit = 10, useDecay = true } = req.body;
    if (!query) return res.json({ results: [] });

    const VectorSearch = require('./vector-search');
    const vs = new VectorSearch();
    await vs.initialize();

    const results = await vs.search(query, {
      limit: parseInt(limit),
      useDecay,
      minSimilarity: 0.15
    });

    res.json(results);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

/**
 * GET /api/graph - Get concept graph data for visualization
 */
app.get('/api/graph', (req, res) => {
  try {
    const msgpack = require('msgpack-lite');
    const graphPath = path.join(MEMEX_PATH, '.neural/graph.msgpack');

    if (!fs.existsSync(graphPath)) {
      return res.status(404).json({ error: 'Graph not built. Run: node neural-memory.js build' });
    }

    const graph = msgpack.decode(fs.readFileSync(graphPath));

    // Convert to vis.js format
    const nodes = [];
    const edges = [];
    const nodeIds = new Map();
    let id = 1;

    for (const [concept, data] of Object.entries(graph.nodes || {})) {
      if (!concept) continue;

      nodeIds.set(concept, id);
      const size = Math.min(10 + (data.w || 1) * 3, 50);

      let color;
      if (data.w >= 5) color = '#e74c3c';
      else if (data.w >= 3) color = '#f39c12';
      else if (data.w >= 2) color = '#3498db';
      else color = '#95a5a6';

      nodes.push({
        id,
        label: concept,
        value: data.w || 1,
        size,
        color,
        title: `${concept}\n${data.w || 1} sessions`
      });
      id++;
    }

    const seenEdges = new Set();
    for (const [from, targets] of Object.entries(graph.edges || {})) {
      const fromId = nodeIds.get(from);
      if (!fromId) continue;

      for (const target of targets || []) {
        const toId = nodeIds.get(target.c);
        if (!toId) continue;

        const edgeKey = fromId < toId ? `${fromId}-${toId}` : `${toId}-${fromId}`;
        if (seenEdges.has(edgeKey)) continue;
        seenEdges.add(edgeKey);

        edges.push({
          from: fromId,
          to: toId,
          value: target.w || 1,
          title: `${target.w || 1} shared sessions`
        });
      }
    }

    res.json({ nodes, edges });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

/**
 * GET /api/topics - Get all topics with counts
 */
app.get('/api/topics', (req, res) => {
  try {
    const indexPath = path.join(MEMEX_PATH, 'index.json');
    const index = JSON.parse(fs.readFileSync(indexPath, 'utf8'));

    const topics = Object.entries(index.t || {})
      .filter(([name]) => name) // Skip empty
      .map(([name, data]) => ({
        name,
        sessions: data.sc || 0,
        projects: data.p || []
      }))
      .sort((a, b) => b.sessions - a.sessions);

    res.json({ topics, total: topics.length });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ─────────────────────────────────────────────────────────────
// Start Server
// ─────────────────────────────────────────────────────────────

app.listen(PORT, () => {
  console.log(`
🧠 Memex Web UI

   Local:   http://localhost:${PORT}
   API:     http://localhost:${PORT}/api/stats

   Press Ctrl+C to stop
`);
});
