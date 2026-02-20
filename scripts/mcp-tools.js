#!/usr/bin/env node

/**
 * MCP Tool Implementations
 *
 * Pure tool logic extracted from mcp-server.mjs for testability.
 * Each function takes its dependencies (paths, modules) as needed.
 */

const fs = require('fs');
const path = require('path');
const { resolveMemexPath } = require('./paths');
const { readJSON } = require('./safe-json');

const MEMEX_PATH = resolveMemexPath(__dirname);

// ─────────────────────────────────────────────────────────────
// Helper Functions
// ─────────────────────────────────────────────────────────────

function loadIndex() {
  const indexPath = path.join(MEMEX_PATH, 'index.json');
  const data = readJSON(indexPath);
  if (!data) throw new Error(`Memex index not found at ${indexPath}`);
  return data;
}

function loadSessionsIndex(project) {
  const sanitized = project.replace(/[^a-zA-Z0-9._-]/g, '');
  const indexPath = path.join(MEMEX_PATH, 'summaries/projects', sanitized, 'sessions-index.json');
  return readJSON(indexPath);
}

function loadGraph() {
  const msgpack = require('msgpack-lite');
  const graphPath = path.join(MEMEX_PATH, '.neural/graph.msgpack');
  if (!fs.existsSync(graphPath)) return null;
  return msgpack.decode(fs.readFileSync(graphPath));
}

function loadBundle(projectName) {
  const sanitized = projectName.replace(/[^a-zA-Z0-9._-]/g, '');
  const msgpack = require('msgpack-lite');
  const bundlePath = path.join(MEMEX_PATH, '.neural/bundles', `${sanitized}.msgpack`);
  if (!fs.existsSync(bundlePath)) return null;
  return msgpack.decode(fs.readFileSync(bundlePath));
}

// ─────────────────────────────────────────────────────────────
// Tool Implementations
// ─────────────────────────────────────────────────────────────

async function neuralSearch(query, limit = 10, useDecay = true) {
  try {
    const VectorSearch = require('./vector-search.js');
    const vs = new VectorSearch();
    await vs.initialize();

    const results = await vs.search(query, {
      limit,
      useDecay,
      minSimilarity: 0.15
    });

    const enriched = results.results.map(r => {
      const parts = r.session_id.split('-');
      const projectPrefix = parts[0];
      return {
        ...r,
        project_hint: projectPrefix
      };
    });

    return {
      query,
      total: results.total_matches,
      decay_enabled: useDecay,
      results: enriched
    };
  } catch (e) {
    return { error: e.message };
  }
}

function getBundle(projectName) {
  const bundle = loadBundle(projectName);
  if (!bundle) {
    return { error: `Bundle not found for project: ${projectName}` };
  }

  return {
    project: projectName,
    description: bundle.d || '',
    tech: bundle.t || '',
    deployment: bundle.dp || '',
    environment: bundle.e || '',
    recent_sessions: bundle.r || [],
    concepts: bundle.c || []
  };
}

function listProjects() {
  const index = loadIndex();
  const projects = Object.entries(index.p || {}).map(([name, data]) => ({
    name,
    sessions: data.sc || 0,
    last_updated: data.u || 'unknown',
    description: data.d || ''
  }));

  return {
    total: projects.length,
    projects: projects.sort((a, b) => b.sessions - a.sessions)
  };
}

function recentSessions(limit = 10) {
  const projectsDir = path.join(MEMEX_PATH, 'summaries/projects');
  if (!fs.existsSync(projectsDir)) return { total: 0, sessions: [] };

  const allSessions = [];

  for (const proj of fs.readdirSync(projectsDir)) {
    const data = loadSessionsIndex(proj);
    if (!data?.sessions) continue;

    for (const s of data.sessions.slice(0, 20)) {
      allSessions.push({
        project: proj,
        id: s.id,
        date: s.date,
        summary: s.summary,
        topics: s.topics || []
      });
    }
  }

  allSessions.sort((a, b) => new Date(b.date) - new Date(a.date));

  return {
    total: allSessions.length,
    sessions: allSessions.slice(0, limit)
  };
}

function getTopics(limit = 30) {
  const index = loadIndex();
  const topics = Object.entries(index.t || {})
    .filter(([name]) => name)
    .map(([name, data]) => ({
      name,
      sessions: data.sc || 0,
      projects: data.p || []
    }))
    .sort((a, b) => b.sessions - a.sessions)
    .slice(0, limit);

  return { total: Object.keys(index.t || {}).length, topics };
}

function queryConcept(concept) {
  const graph = loadGraph();
  if (!graph) return { error: 'Graph not built. Run: node neural-memory.js build' };

  const normalized = concept.toLowerCase().trim();
  const node = graph.nodes?.[normalized];

  if (!node) {
    return { found: false, concept: normalized, suggestion: 'Try a different term' };
  }

  const related = (graph.edges?.[normalized] || [])
    .map(r => ({ concept: r.c, strength: r.w }))
    .sort((a, b) => b.strength - a.strength)
    .slice(0, 10);

  return {
    found: true,
    concept: normalized,
    sessions_count: node.w,
    related_concepts: related
  };
}

async function crossProjectSearch(query, limit = 20) {
  try {
    const GitIndexer = require('./index-git.js');
    const indexer = new GitIndexer();
    const result = await indexer.query(query, { limit });

    if (result.error) {
      return { error: result.error };
    }

    const grouped = {};
    for (const item of result.results || []) {
      if (!grouped[item.project]) {
        grouped[item.project] = [];
      }
      grouped[item.project].push(item);
    }

    return {
      query,
      total: result.total || 0,
      by_project: grouped
    };
  } catch (e) {
    return { error: e.message };
  }
}

function getStats() {
  const index = loadIndex();
  return {
    version: index.v,
    last_updated: index.u,
    total_sessions: index.m?.ts || 0,
    total_topics: Object.keys(index.t || {}).length,
    projects: Object.keys(index.p || {}).length
  };
}

function getGraphSummary() {
  const graph = loadGraph();
  if (!graph) return { error: 'Graph not built' };

  return {
    concepts: Object.keys(graph.nodes || {}).length,
    connections: Object.values(graph.edges || {}).reduce((sum, arr) => sum + arr.length, 0),
    top_concepts: Object.entries(graph.nodes || {})
      .sort((a, b) => b[1].w - a[1].w)
      .slice(0, 20)
      .map(([name, data]) => ({ name, sessions: data.w }))
  };
}

module.exports = {
  loadIndex,
  loadSessionsIndex,
  loadGraph,
  loadBundle,
  neuralSearch,
  getBundle,
  listProjects,
  recentSessions,
  getTopics,
  queryConcept,
  crossProjectSearch,
  getStats,
  getGraphSummary,
};
