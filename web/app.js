/**
 * Memex Web UI - Frontend Application
 */

// ─────────────────────────────────────────────────────────────
// Utilities
// ─────────────────────────────────────────────────────────────

/** Escape HTML to prevent XSS */
function esc(str) {
  const d = document.createElement('div');
  d.textContent = str;
  return d.innerHTML;
}

// ─────────────────────────────────────────────────────────────
// State
// ─────────────────────────────────────────────────────────────

const state = {
  currentView: 'dashboard',
  stats: null,
  projects: [],
  topics: [],
  graph: null,
  selectedProject: null,
  searchTimeout: null
};

// ─────────────────────────────────────────────────────────────
// API
// ─────────────────────────────────────────────────────────────

const api = {
  async get(endpoint) {
    const res = await fetch(`/api${endpoint}`);
    return res.json();
  },

  async post(endpoint, body) {
    const res = await fetch(`/api${endpoint}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });
    return res.json();
  }
};

// ─────────────────────────────────────────────────────────────
// Navigation
// ─────────────────────────────────────────────────────────────

function initNavigation() {
  document.querySelectorAll('.nav-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const view = btn.dataset.view;
      switchView(view);
    });
  });
}

function switchView(view) {
  // Update nav buttons
  document.querySelectorAll('.nav-btn').forEach(btn => {
    const isActive = btn.dataset.view === view;
    btn.classList.toggle('active', isActive);
    btn.setAttribute('aria-pressed', isActive ? 'true' : 'false');
  });

  // Update views
  document.querySelectorAll('.view').forEach(v => {
    v.classList.toggle('active', v.id === `view-${view}`);
  });

  state.currentView = view;

  // Load view-specific data
  if (view === 'graph' && !state.graph) {
    loadGraph();
  }
  if (view === 'sessions' && state.projects.length === 0) {
    loadProjectTabs();
  }
  if (view === 'assertions') {
    loadAssertions(1);
  }
}

// ─────────────────────────────────────────────────────────────
// Dashboard
// ─────────────────────────────────────────────────────────────

async function loadDashboard() {
  // Load stats
  const stats = await api.get('/stats');
  state.stats = stats;

  document.getElementById('stat-sessions').textContent = stats.totalSessions;
  document.getElementById('stat-projects').textContent = stats.projects.length;
  document.getElementById('stat-topics').textContent = stats.totalTopics;
  document.getElementById('total-sessions').textContent = stats.totalSessions;

  // Load projects
  const projectsHtml = stats.projects
    .sort((a, b) => b.sessions - a.sessions)
    .map(p => `
      <div class="project-item" onclick="viewProject('${esc(p.name)}')">
        <span class="project-name">${esc(p.name)}</span>
        <span class="project-sessions">${p.sessions} sessions</span>
      </div>
    `).join('');

  document.getElementById('projects-list').innerHTML = projectsHtml || '<div class="empty-state">No projects</div>';

  // Load topics
  const topicsData = await api.get('/topics');
  state.topics = topicsData.topics;

  const topicsHtml = topicsData.topics
    .slice(0, 20)
    .map(t => {
      const cls = t.sessions >= 5 ? 'hot' : t.sessions >= 3 ? 'warm' : '';
      return `<span class="topic-tag ${cls}" onclick="searchTopic('${esc(t.name)}')">${esc(t.name)}</span>`;
    }).join('');

  document.getElementById('topics-cloud').innerHTML = topicsHtml || '<div class="empty-state">No topics</div>';

  // Load recent sessions
  await loadRecentSessions();

  // Load AgentBridge status
  await loadBridgeStatus();
}

async function loadBridgeStatus() {
  const container = document.getElementById('agentbridge-status');
  try {
    const data = await api.get('/agentbridge/status');
    const connected = data.bridge_connected;
    const consumer = data.consumer || {};

    const statusDot = connected ? 'connected' : (consumer.configured ? 'configured' : 'disabled');
    const statusLabel = connected ? 'Connected' : (consumer.configured ? 'Disconnected' : 'Disabled');

    container.innerHTML = `
      <div class="bridge-row">
        <span class="bridge-dot ${statusDot}"></span>
        <span>${statusLabel}</span>
      </div>
      ${data.bridge_url ? `<div class="bridge-row bridge-meta">${esc(data.bridge_url)}</div>` : ''}
      <div class="bridge-row bridge-meta">
        Events: ${consumer.events_processed || 0} processed, ${consumer.errors || 0} errors
      </div>
      ${consumer.last_event_at ? `<div class="bridge-row bridge-meta">Last: ${consumer.last_event_at}</div>` : ''}
    `;
  } catch {
    container.innerHTML = '<div class="bridge-row bridge-meta">Status unavailable</div>';
  }
}

async function loadRecentSessions() {
  const projectsData = await api.get('/projects');
  state.projects = projectsData.projects;

  // Gather recent sessions from all projects
  const allSessions = [];

  for (const proj of projectsData.projects) {
    const sessionsData = await api.get(`/sessions/${proj.name}?limit=5`);
    for (const s of sessionsData.sessions) {
      allSessions.push({ ...s, project: proj.name });
    }
  }

  // Sort by date descending
  allSessions.sort((a, b) => new Date(b.date) - new Date(a.date));

  const sessionsHtml = allSessions.slice(0, 10).map(s => `
    <div class="session-item" onclick="viewProject('${esc(s.project)}')">
      <div class="session-header">
        <span class="session-date">${esc(s.date)}</span>
        <span class="session-project">${esc(s.project)}</span>
      </div>
      <div class="session-summary">${esc(s.summary)}</div>
      <div class="session-topics">
        ${(s.topics || []).slice(0, 5).map(t => `<span class="session-topic">${esc(t)}</span>`).join('')}
      </div>
    </div>
  `).join('');

  document.getElementById('recent-sessions').innerHTML = sessionsHtml || '<div class="empty-state">No sessions</div>';
}

// ─────────────────────────────────────────────────────────────
// Search
// ─────────────────────────────────────────────────────────────

function initSearch() {
  const input = document.getElementById('search-input');
  const semanticToggle = document.getElementById('semantic-toggle');
  const decayToggle = document.getElementById('decay-toggle');

  input.addEventListener('input', () => {
    clearTimeout(state.searchTimeout);
    state.searchTimeout = setTimeout(() => {
      performSearch(input.value, semanticToggle.checked, decayToggle.checked);
    }, 300);
  });
}

async function performSearch(query, semantic, decay) {
  const resultsContainer = document.getElementById('search-results');

  if (!query.trim()) {
    resultsContainer.innerHTML = '<div class="search-hint">Type to search across all sessions and projects</div>';
    return;
  }

  resultsContainer.innerHTML = '<div class="loading">Searching...</div>';

  let results;

  if (semantic) {
    results = await api.post('/semantic-search', {
      query,
      limit: 20,
      useDecay: decay
    });
  } else {
    results = await api.get(`/search?q=${encodeURIComponent(query)}&limit=20`);
  }

  if (!results.results || results.results.length === 0) {
    resultsContainer.innerHTML = '<div class="search-hint">No results found</div>';
    return;
  }

  const html = results.results.map(r => {
    const score = r.score !== undefined ? `Score: ${r.score}` : '';
    const decay = r.decay !== undefined ? ` (decay: ${r.decay})` : '';
    const project = r.project || r.session_id?.split('-')[0] || 'unknown';

    return `
      <div class="search-result">
        <div class="result-header">
          <span class="result-project">${esc(project)}</span>
          <span class="result-score">${esc(score)}${esc(decay)}</span>
        </div>
        <div class="result-summary">${esc(r.summary || r.text_preview || r.session_id)}</div>
        <div class="result-meta">
          <span>${esc(r.date || r.session_id)}</span>
          ${(r.topics || []).map(t => `<span>${esc(t)}</span>`).join('')}
        </div>
      </div>
    `;
  }).join('');

  resultsContainer.innerHTML = html;
}

function searchTopic(topic) {
  switchView('search');
  document.getElementById('search-input').value = topic;
  performSearch(topic, true, true);
}

// ─────────────────────────────────────────────────────────────
// Graph
// ─────────────────────────────────────────────────────────────

async function loadGraph() {
  const container = document.getElementById('graph-canvas');
  container.innerHTML = '<div class="loading" style="padding: 40px;">Loading graph...</div>';

  try {
    const data = await api.get('/graph');
    state.graph = data;

    const nodes = new vis.DataSet(data.nodes);
    const edges = new vis.DataSet(data.edges);

    const options = {
      nodes: {
        shape: 'dot',
        font: { color: '#e6edf3', size: 12 },
        borderWidth: 2,
        shadow: true
      },
      edges: {
        color: { color: '#30363d', highlight: '#58a6ff' },
        smooth: { type: 'continuous' }
      },
      physics: {
        forceAtlas2Based: {
          gravitationalConstant: -50,
          centralGravity: 0.01,
          springLength: 100,
          springConstant: 0.08
        },
        maxVelocity: 50,
        solver: 'forceAtlas2Based',
        timestep: 0.35,
        stabilization: { iterations: 150 }
      },
      interaction: {
        hover: true,
        tooltipDelay: 100
      }
    };

    const network = new vis.Network(container, { nodes, edges }, options);

    // Graph search
    document.getElementById('graph-search').addEventListener('input', (e) => {
      const query = e.target.value.toLowerCase();
      if (!query) {
        nodes.forEach(node => nodes.update({ id: node.id, opacity: 1 }));
        return;
      }

      nodes.forEach(node => {
        const match = node.label.toLowerCase().includes(query);
        nodes.update({
          id: node.id,
          opacity: match ? 1 : 0.2,
          font: { color: match ? '#fff' : '#555' }
        });
        if (match) {
          network.focus(node.id, { scale: 1.5, animation: true });
        }
      });
    });

    network.on('click', (params) => {
      if (params.nodes.length > 0) {
        network.focus(params.nodes[0], { scale: 1.5, animation: true });
      }
    });

  } catch (e) {
    container.innerHTML = `<div class="empty-state">Failed to load graph: ${e.message}</div>`;
  }
}

// ─────────────────────────────────────────────────────────────
// Sessions View
// ─────────────────────────────────────────────────────────────

async function loadProjectTabs() {
  const projectsData = await api.get('/projects');
  state.projects = projectsData.projects;

  const html = projectsData.projects
    .sort((a, b) => b.sessions - a.sessions)
    .map(p => `
      <div class="project-tab" onclick="selectProject('${esc(p.name)}')" data-project="${esc(p.name)}">
        <span>${esc(p.name)}</span>
        <span class="count">${p.sessions}</span>
      </div>
    `).join('');

  document.getElementById('project-tabs').innerHTML = html;
}

async function selectProject(name) {
  state.selectedProject = name;

  // Update tabs
  document.querySelectorAll('.project-tab').forEach(tab => {
    tab.classList.toggle('active', tab.dataset.project === name);
  });

  // Load sessions
  const container = document.getElementById('sessions-list-full');
  container.innerHTML = '<div class="loading">Loading sessions...</div>';

  const data = await api.get(`/sessions/${name}?limit=100`);

  const html = data.sessions.map(s => `
    <div class="session-card">
      <div class="date">${esc(s.date)}</div>
      <div class="summary">${esc(s.summary)}</div>
      <div class="topics">
        ${(s.topics || []).map(t => `<span class="session-topic">${esc(t)}</span>`).join('')}
      </div>
    </div>
  `).join('');

  container.innerHTML = html || '<div class="empty-state">No sessions</div>';
}

function viewProject(name) {
  switchView('sessions');
  setTimeout(() => selectProject(name), 100);
}

// ─────────────────────────────────────────────────────────────
// Assertions View
// ─────────────────────────────────────────────────────────────

const assertionsState = {
  timeout: null,
};

async function loadAssertions(page = 1) {
  const container = document.getElementById('assertions-list');
  const q = (document.getElementById('assertions-search')?.value || '').trim();
  const status = document.getElementById('assertions-status')?.value || '';
  const limit = 50;

  container.innerHTML = '<div class="loading">Loading...</div>';

  const params = new URLSearchParams({ page, limit });
  if (q) params.set('q', q);
  if (status) params.set('status', status);

  const data = await api.get(`/assertions?${params.toString()}`);

  if (!data.assertions || data.assertions.length === 0) {
    container.innerHTML = '<div class="empty-state">No assertions found</div>';
    return;
  }

  const html = data.assertions.map(a => {
    const confidence = typeof a.confidence === 'number'
      ? `${Math.round(a.confidence * 100)}%`
      : '—';
    return `
      <div class="assertion-item">
        <div class="assertion-header">
          <span class="assertion-claim">${esc(a.claim)}</span>
          <span class="assertion-badge" data-status="${esc(a.status || '')}">${esc(a.status || 'unknown')}</span>
        </div>
        <div class="assertion-meta">
          <span>Confidence: ${esc(confidence)}</span>
          <span>Plane: ${esc(a.plane || '—')}</span>
          <span>Class: ${esc(a.class || '—')}</span>
          ${a.density_hint ? `<span>${esc(a.density_hint)}</span>` : ''}
        </div>
      </div>
    `;
  }).join('');

  container.innerHTML = html;
}

function initAssertions() {
  const searchInput = document.getElementById('assertions-search');
  const statusSelect = document.getElementById('assertions-status');

  searchInput.addEventListener('input', () => {
    clearTimeout(assertionsState.timeout);
    assertionsState.timeout = setTimeout(() => loadAssertions(1), 300);
  });

  statusSelect.addEventListener('change', () => loadAssertions(1));
}

// ─────────────────────────────────────────────────────────────
// Keyboard Navigation
// ─────────────────────────────────────────────────────────────

const VIEW_KEYS = ['dashboard', 'search', 'graph', 'sessions', 'assertions'];

function initKeyboard() {
  document.addEventListener('keydown', (e) => {
    const tag = document.activeElement?.tagName?.toLowerCase();
    const inInput = tag === 'input' || tag === 'textarea' || tag === 'select';

    if (e.key === 'Escape') {
      document.activeElement?.blur();
      return;
    }

    if (e.key === '/' && !inInput) {
      e.preventDefault();
      switchView('search');
      document.getElementById('search-input')?.focus();
      return;
    }

    if (!inInput) {
      const idx = parseInt(e.key, 10);
      if (idx >= 1 && idx <= VIEW_KEYS.length) {
        switchView(VIEW_KEYS[idx - 1]);
      }
    }
  });
}

// ─────────────────────────────────────────────────────────────
// Init
// ─────────────────────────────────────────────────────────────

document.addEventListener('DOMContentLoaded', () => {
  initNavigation();
  initSearch();
  initAssertions();
  initKeyboard();
  loadDashboard();
});
