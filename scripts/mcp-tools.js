#!/usr/bin/env node

/**
 * MCP Tool Implementations
 *
 * Pure tool logic extracted from mcp-server.mjs for testability.
 * Each function takes its dependencies (paths, modules) as needed.
 */

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const { resolveCodicilPath, resolveProjectDirName } = require('./paths');
const { readJSON } = require('./safe-json');
const { updateMetrics } = require('./metrics');

const CODICIL_PATH = resolveCodicilPath(__dirname);

// ─────────────────────────────────────────────────────────────
// Helper Functions
// ─────────────────────────────────────────────────────────────

function loadIndex() {
  const indexPath = path.join(CODICIL_PATH, 'index.json');
  const data = readJSON(indexPath);
  if (!data) throw new Error(`Codicil index not found at ${indexPath}`);
  return data;
}

function loadSessionsIndex(project) {
  const projectDirName = resolveProjectDirName(CODICIL_PATH, project);
  const indexPath = path.join(CODICIL_PATH, 'summaries/projects', projectDirName, 'sessions-index.json');
  return readJSON(indexPath);
}

function loadGraph() {
  const msgpack = require('msgpack-lite');
  const graphPath = path.join(CODICIL_PATH, '.neural/graph.msgpack');
  if (!fs.existsSync(graphPath)) return null;
  return msgpack.decode(fs.readFileSync(graphPath));
}

function loadBundle(projectName) {
  const sanitized = resolveProjectDirName(CODICIL_PATH, projectName) || projectName.replace(/[^a-zA-Z0-9._-]/g, '');
  const msgpack = require('msgpack-lite');
  const bundlePath = path.join(CODICIL_PATH, '.neural/bundles', `${sanitized}.msgpack`);
  if (!fs.existsSync(bundlePath)) return null;
  return msgpack.decode(fs.readFileSync(bundlePath));
}

// ─────────────────────────────────────────────────────────────
// Tool Implementations
// ─────────────────────────────────────────────────────────────

const VectorSearch = require('./vector-search.js');
const vectorSearch = new VectorSearch();
let vectorSearchReady = null;
let codicilLoader = null;

async function getVectorSearch() {
  if (!vectorSearchReady) {
    vectorSearchReady = vectorSearch.initialize();
  }
  await vectorSearchReady;
  return vectorSearch;
}

function getCodicilLoader() {
  if (!codicilLoader) {
    const Codicil = require('./codicil-loader');
    codicilLoader = new Codicil();
  }
  return codicilLoader;
}

async function neuralSearch(query, limit = 10, useDecay = true) {
  try {
    const startedAt = Date.now();
    const vs = await getVectorSearch();

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

    const payload = {
      query,
      total: results.total_matches,
      decay_enabled: useDecay,
      results: enriched
    };
    updateMetrics((metrics) => {
      metrics.neural_search_calls_total += 1;
      metrics.last_search_at = new Date().toISOString();
      return metrics;
    }).catch(() => {});
    return payload;
  } catch (e) {
    return { error: e.message };
  }
}

const RESERVED_PROJECTS = new Set(['__global__', '__test__', '__system__']);

function buildValidationError(code, message, field, value) {
  return {
    error: true,
    code,
    message,
    field,
    value: String(value ?? '').slice(0, 100)
  };
}

function validateRememberInput(args) {
  if (!args || typeof args !== 'object') {
    return buildValidationError('CODICIL_ERR_SUMMARY_REQUIRED', 'summary is required', 'summary', '');
  }

  const summary = typeof args.summary === 'string' ? args.summary.trim() : '';
  if (!summary) {
    return buildValidationError('CODICIL_ERR_SUMMARY_REQUIRED', 'summary is required', 'summary', args.summary);
  }
  if (summary.length > 1000) {
    return buildValidationError('CODICIL_ERR_SUMMARY_TOO_LONG', `summary must be 1000 characters or fewer (got ${summary.length})`, 'summary', summary);
  }

  const topics = Array.isArray(args.topics) ? args.topics.map(t => (typeof t === 'string' ? t.trim() : '')).filter(Boolean) : [];
  if (topics.length === 0) {
    return buildValidationError('CODICIL_ERR_TOPICS_REQUIRED', 'topics must be a non-empty array', 'topics', args.topics);
  }
  if (topics.length > 20) {
    return buildValidationError('CODICIL_ERR_TOPICS_TOO_MANY', 'topics must contain 20 or fewer items', 'topics', topics.length);
  }
  for (let i = 0; i < topics.length; i++) {
    if (topics[i].length > 50) {
      return buildValidationError('CODICIL_ERR_TOPIC_TOO_LONG', `each topic must be 50 characters or fewer (got '${topics[i].slice(0, 10)}...' at index ${i})`, 'topics', topics[i]);
    }
  }

  const projectRaw = typeof args.project === 'string' ? args.project.trim() : '';
  if (!projectRaw) {
    return buildValidationError('CODICIL_ERR_PROJECT_REQUIRED', 'project is required when calling remember via MCP', 'project', args.project);
  }
  if (projectRaw.length > 100) {
    return buildValidationError('CODICIL_ERR_PROJECT_TOO_LONG', 'project name must be 100 characters or fewer', 'project', projectRaw);
  }
  if (projectRaw.includes('..')) {
    return buildValidationError('CODICIL_ERR_PROJECT_INVALID_CHARS', 'project name may only contain letters, numbers, dots, underscores, and hyphens', 'project', projectRaw);
  }
  if (/[^a-zA-Z0-9._-]/.test(projectRaw)) {
    return buildValidationError('CODICIL_ERR_PROJECT_INVALID_CHARS', 'project name may only contain letters, numbers, dots, underscores, and hyphens', 'project', projectRaw);
  }
  if (RESERVED_PROJECTS.has(projectRaw)) {
    return buildValidationError('CODICIL_ERR_PROJECT_RESERVED', `project name '${projectRaw}' is reserved`, 'project', projectRaw);
  }

  const keyDecisions = Array.isArray(args.key_decisions) ? args.key_decisions : [];
  const learnings = Array.isArray(args.learnings) ? args.learnings : [];

  return {
    summary,
    topics,
    project: projectRaw,
    key_decisions: keyDecisions,
    learnings
  };
}

async function remember(args) {
  try {
    const validated = validateRememberInput(args);
    if (validated.error) return validated;

    const SessionSaver = require('./save-session.js');
    const saver = new SessionSaver({ project: validated.project });

    const result = await saver.saveSession(
      validated.summary,
      validated.topics,
      null,
      {
        commit: false,
        include_git_changes: false,
        key_decisions: validated.key_decisions,
        learnings: validated.learnings
      }
    );

    let embeddingGenerated = false;
    try {
      const vs = await getVectorSearch();
      const embeddingResult = await vs.addSessionEmbedding(result.session, { persist: true });
      embeddingGenerated = embeddingResult.embedded === true;
    } catch (e) {
      embeddingGenerated = false;
    }

    const payload = {
      session_id: result.session_id,
      project: result.project,
      saved: true,
      embedding_generated: embeddingGenerated
    };
    updateMetrics((metrics) => {
      metrics.remember_calls_total += 1;
      metrics.sessions_total += 1;
      metrics.last_remember_at = new Date().toISOString();
      return metrics;
    }).catch(() => {});
    return payload;
  } catch (e) {
    updateMetrics((metrics) => {
      metrics.remember_failures_total += 1;
      return metrics;
    }).catch(() => {});
    return buildValidationError('CODICIL_ERR_WRITE_FAILED', `failed to save session: ${e.message}`, 'session', '');
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
  const projectsDir = path.join(CODICIL_PATH, 'summaries/projects');
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

function searchSessions(query, project = null, limit = 10) {
  const normalizedQuery = typeof query === 'string' ? query.trim().toLowerCase() : '';
  if (!normalizedQuery) {
    return { error: 'query is required' };
  }

  const results = [];
  const projectsDir = path.join(CODICIL_PATH, 'summaries/projects');

  let projectDirs = [];
  if (project) {
    const resolved = resolveProjectDirName(CODICIL_PATH, project);
    if (!resolved) {
      return { query, project, total: 0, results: [] };
    }
    projectDirs = [resolved];
  } else if (fs.existsSync(projectsDir)) {
    projectDirs = fs.readdirSync(projectsDir);
  }

  const codicil = getCodicilLoader();

  for (const projectDirName of projectDirs) {
    let sessions = [];
    try {
      codicil.loadIndex();
      sessions = codicil.listSessions(projectDirName) || [];
    } catch {
      const indexPath = path.join(projectsDir, projectDirName, 'sessions-index.json');
      const sessionsIndex = readJSON(indexPath);
      sessions = sessionsIndex?.sessions || [];
    }

    for (const session of sessions) {
      const summary = typeof session.summary === 'string' ? session.summary : '';
      const topics = Array.isArray(session.topics) ? session.topics : [];
      const summaryMatch = summary.toLowerCase().includes(normalizedQuery);
      const topicsMatch = topics.some(topic => typeof topic === 'string' && topic.toLowerCase().includes(normalizedQuery));
      if (!summaryMatch && !topicsMatch) continue;

      results.push({
        project: session.project_display || session.project || projectDirName,
        id: session.id,
        date: session.date,
        summary,
        topics
      });
    }
  }

  results.sort((a, b) => new Date(b.date) - new Date(a.date));

  return {
    query,
    total: results.length,
    results: results.slice(0, limit)
  };
}

function getSession(project, sessionId) {
  const projectName = typeof project === 'string' ? project.trim() : '';
  const id = typeof sessionId === 'string' ? sessionId.trim() : '';

  if (!projectName) {
    return buildValidationError('CODICIL_ERR_PROJECT_REQUIRED', 'project is required', 'project', project);
  }
  if (!id) {
    return buildValidationError('CODICIL_ERR_SESSION_NOT_FOUND', 'session_id is required', 'session_id', sessionId);
  }

  const codicil = getCodicilLoader();
  const session = codicil.loadSessionDetails(projectName, id);
  if (!session) {
    return buildValidationError(
      'CODICIL_ERR_SESSION_NOT_FOUND',
      `session '${id}' not found in project '${projectName}'`,
      'session_id',
      id
    );
  }

  return session;
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

function rebuildIndex(args = {}) {
  const options = args && typeof args === 'object' ? args : {};
  const doBloom = options.bloom !== false;
  const doGit = options.git === true;
  const doEmbeddings = options.embeddings === true;

  const results = {
    bloom: null,
    git: null,
    embeddings: null
  };

  try {
    if (doBloom) {
      execFileSync(process.execPath, [path.join(__dirname, 'bloom-filter.js'), 'build'], {
        cwd: CODICIL_PATH,
        stdio: 'ignore'
      });
      results.bloom = 'rebuilt';
    }
  } catch (e) {
    results.bloom = `error: ${e.message}`;
  }

  try {
    if (doGit) {
      execFileSync(process.execPath, [path.join(__dirname, 'index-git.js'), 'build'], {
        cwd: CODICIL_PATH,
        stdio: 'ignore'
      });
      results.git = 'rebuilt';
    }
  } catch (e) {
    results.git = `error: ${e.message}`;
  }

  try {
    if (doEmbeddings) {
      execFileSync(process.execPath, [path.join(__dirname, 'vector-search.js'), 'generate'], {
        cwd: CODICIL_PATH,
        stdio: 'ignore'
      });
      results.embeddings = 'rebuilt';
    }
  } catch (e) {
    results.embeddings = `error: ${e.message}`;
  }

  return {
    ok: true,
    results
  };
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

// ─────────────────────────────────────────────────────────────
// Ledger Tools (Phase 6)
// ─────────────────────────────────────────────────────────────

function ledgerIngest(params) {
  try {
    const ledger = require('./ledger.js');
    const id = ledger.ingest(params);
    return { ok: true, id };
  } catch (e) {
    return { error: `ledger ingest failed: ${e.message}` };
  }
}

function ledgerQuery(plane, opts = {}) {
  try {
    const ledger = require('./ledger.js');
    const assertions = ledger.queryActiveByPlane(plane, opts);
    return { ok: true, plane, total: assertions.length, assertions };
  } catch (e) {
    return { error: `ledger query failed: ${e.message}` };
  }
}

function ledgerSelectContext(plane, budget, opts = {}) {
  try {
    const ledger = require('./ledger.js');
    const { renderBlock } = require('./render.js');
    const assertions = ledger.selectForContext(plane, budget, opts);
    const rendered = renderBlock(assertions, opts);
    return {
      ok: true,
      plane,
      budget,
      selected: assertions.length,
      used: assertions.reduce((sum, a) => sum + (a.claim?.length || 0), 0),
      rendered
    };
  } catch (e) {
    return { error: `ledger select context failed: ${e.message}` };
  }
}

function ledgerStats() {
  try {
    const ledger = require('./ledger.js');
    const stats = ledger.stats();
    return { ok: true, stats };
  } catch (e) {
    return { error: `ledger stats failed: ${e.message}` };
  }
}

// ─────────────────────────────────────────────────────────────
// Ledger Tools (Phase 8)
// ─────────────────────────────────────────────────────────────

function ledgerScanSentinel(plane, { sampleSize = 50, threshold = 0.7 } = {}) {
  try {
    const { scanPlane } = require('./contradiction-sentinel');
    const result = scanPlane(plane, { sampleSize, threshold });
    // scanPlane returns a Promise (async function), resolve it
    if (result && typeof result.then === 'function') {
      // Callers expecting sync must await — but MCP tools are async-capable
      return result.then(r => ({ ok: true, plane, ...r }));
    }
    return { ok: true, plane, ...result };
  } catch (e) {
    return { error: `ledger scan sentinel failed: ${e.message}` };
  }
}

function ledgerRunVerifications(plane, { staleDays = 14 } = {}) {
  try {
    const ledger = require('./ledger');
    const hooks = require('./verification-hooks');
    const assertions = ledger.queryActiveByPlane(plane, { classes: ['state_bound'] });
    const resultPromise = hooks.runPending(assertions, {
      staleDays,
      onVerified: (id) => ledger.markVerified(id),
    });
    if (resultPromise && typeof resultPromise.then === 'function') {
      return resultPromise.then(results => ({ ok: true, plane, results }));
    }
    return { ok: true, plane, results: resultPromise };
  } catch (e) {
    return { error: `ledger run verifications failed: ${e.message}` };
  }
}

function ledgerWeight(id, value) {
  try {
    const ledger = require('./ledger');
    ledger.setCounterfactualWeight(id, value);
    return { ok: true, id, value };
  } catch (e) {
    return { error: `ledger weight failed: ${e.message}` };
  }
}

// ─────────────────────────────────────────────────────────────
// Ledger Tools (Phase 9)
// ─────────────────────────────────────────────────────────────

async function ledgerTransform(plane, opts = {}) {
  try {
    const { transformPlane } = require('./transform');
    const result = await transformPlane(plane, {
      dryRun: opts.dry_run !== false,
      action: opts.action || 'all',
      confidenceThreshold: opts.confidence_threshold || 0.7,
      staleDays: opts.stale_days || 14,
      maxAgeDays: opts.max_age_days || 90,
      yes: opts.yes === true,
    });
    return { ok: true, plane, ...result };
  } catch (e) {
    return { error: `ledger transform failed: ${e.message}` };
  }
}

async function ledgerReportOutcome(params) {
  try {
    const { session_id, reply_text, mode = 'post_hoc' } = params || {};

    if (!session_id || typeof session_id !== 'string') {
      return { error: 'ledger_report_outcome: session_id is required' };
    }
    if (!reply_text || typeof reply_text !== 'string') {
      return { error: 'ledger_report_outcome: reply_text is required' };
    }
    if (!['post_hoc', 'citation', 'both'].includes(mode)) {
      return { error: 'ledger_report_outcome: mode must be post_hoc, citation, or both' };
    }

    const Database = require('better-sqlite3');
    const path = require('path');
    const { resolveCodicilPath } = require('./paths');
    const dbPath = path.join(resolveCodicilPath(__dirname), '.cache', 'codicil.db');
    const fs = require('fs');
    if (!fs.existsSync(dbPath)) {
      return { ok: true, session_id, post_hoc: null, citation: null, message: 'ledger DB not initialized' };
    }
    const db = new Database(dbPath);

    let postHocResult = null;
    let citationResult = null;

    if (mode === 'post_hoc' || mode === 'both') {
      const { scoreReply } = require('./capture');
      postHocResult = await scoreReply(session_id, reply_text, { db });
    }

    if (mode === 'citation' || mode === 'both') {
      const { scoreCitations } = require('./feedback/score-citations');
      citationResult = await scoreCitations({ sessionId: session_id, replyText: reply_text, db });
    }

    return { ok: true, session_id, post_hoc: postHocResult, citation: citationResult };
  } catch (e) {
    return { error: `ledger_report_outcome failed: ${e.message}` };
  }
}

module.exports = {
  loadIndex,
  loadSessionsIndex,
  loadGraph,
  loadBundle,
  neuralSearch,
  getSession,
  searchSessions,
  getBundle,
  listProjects,
  recentSessions,
  getTopics,
  queryConcept,
  crossProjectSearch,
  remember,
  rebuildIndex,
  getStats,
  getGraphSummary,
  ledgerIngest,
  ledgerQuery,
  ledgerSelectContext,
  ledgerStats,
  ledgerScanSentinel,
  ledgerRunVerifications,
  ledgerWeight,
  ledgerTransform,
  ledgerReportOutcome,
};
