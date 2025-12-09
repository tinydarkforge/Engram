#!/usr/bin/env node

/**
 * Graph Visualization - Generate interactive HTML concept map
 *
 * Usage:
 *   node graph-viz.js                        Generate global graph (all projects)
 *   node graph-viz.js --project Memex        Generate project-specific graph
 *   node graph-viz.js --no-open              Generate without opening browser
 *   node graph-viz.js --deploy               Deploy global graph to all repos
 */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const msgpack = require('msgpack-lite');

const MEMEX_PATH = process.env.MEMEX_PATH || path.join(process.env.HOME, 'code/cirrus/DevOps/Memex');
const REDACTED_PATH = path.join(process.env.HOME, 'code/cirrus');
const GRAPH_PATH = path.join(MEMEX_PATH, '.neural', 'graph.msgpack');

// Known repositories (same as deploy-neural.js)
const REPO_MAP = {
  'DemoProject': path.join(REDACTED_PATH, 'DemoProject'),
  'translate.REDACTED': path.join(REDACTED_PATH, 'translateREDACTED'),
  'DevOps': path.join(REDACTED_PATH, 'DevOps'),
  'Memex': path.join(REDACTED_PATH, 'DevOps/Memex'),
  'REDACTED': path.join(REDACTED_PATH, 'REDACTED'),
  'ProjectB': path.join(REDACTED_PATH, 'ProjectB'),
  'REDACTED': path.join(REDACTED_PATH, 'REDACTED'),
  'REDACTED': path.join(REDACTED_PATH, 'REDACTED')
};

/**
 * Load all sessions to map concepts to projects
 */
function loadSessionProjects() {
  const sessionToProject = {};
  const projectsDir = path.join(MEMEX_PATH, 'summaries/projects');

  if (!fs.existsSync(projectsDir)) return sessionToProject;

  for (const project of fs.readdirSync(projectsDir)) {
    const indexPath = path.join(projectsDir, project, 'sessions-index.json');
    if (!fs.existsSync(indexPath)) continue;

    try {
      const data = JSON.parse(fs.readFileSync(indexPath, 'utf8'));
      for (const session of data.sessions || []) {
        sessionToProject[session.id] = project;
      }
    } catch (e) {
      // Skip
    }
  }

  return sessionToProject;
}

/**
 * Get list of projects that have concepts in the graph
 */
function getProjectsWithConcepts(graph, sessionToProject) {
  const projectConcepts = {};

  for (const [concept, data] of Object.entries(graph.nodes)) {
    for (const sessionId of (data.s || [])) {
      const project = sessionToProject[sessionId];
      if (project) {
        if (!projectConcepts[project]) projectConcepts[project] = new Set();
        projectConcepts[project].add(concept);
      }
    }
  }

  // Return projects sorted by concept count (descending)
  return Object.entries(projectConcepts)
    .map(([name, concepts]) => ({ name, conceptCount: concepts.size }))
    .sort((a, b) => b.conceptCount - a.conceptCount);
}

/**
 * Filter graph to only include concepts from a specific project
 */
function filterGraphByProject(graph, projectName, sessionToProject) {
  const filteredNodes = {};
  const filteredEdges = {};
  const filteredReverse = {};

  // Find sessions belonging to this project
  const projectSessions = new Set(
    Object.entries(sessionToProject)
      .filter(([_, proj]) => proj.toLowerCase() === projectName.toLowerCase())
      .map(([id]) => id)
  );

  // Filter nodes - keep only concepts that appear in project sessions
  for (const [concept, data] of Object.entries(graph.nodes)) {
    const projectSessionsForConcept = (data.s || []).filter(s => projectSessions.has(s));
    if (projectSessionsForConcept.length > 0) {
      filteredNodes[concept] = {
        w: projectSessionsForConcept.length,
        s: projectSessionsForConcept
      };
    }
  }

  // Filter edges - keep only edges between filtered nodes
  for (const [from, targets] of Object.entries(graph.edges)) {
    if (!filteredNodes[from]) continue;

    const filteredTargets = targets.filter(t => filteredNodes[t.c]);
    if (filteredTargets.length > 0) {
      filteredEdges[from] = filteredTargets;
    }
  }

  // Filter reverse index
  for (const [sessionId, concepts] of Object.entries(graph.reverse || {})) {
    if (projectSessions.has(sessionId)) {
      filteredReverse[sessionId] = concepts.filter(c => filteredNodes[c]);
    }
  }

  return {
    v: graph.v,
    nodes: filteredNodes,
    edges: filteredEdges,
    reverse: filteredReverse
  };
}

function generateVisualization(options = {}) {
  const { projectFilter, outputPath } = options;
  const title = projectFilter ? `${projectFilter} Concepts` : 'All Projects';

  console.log(`🎨 Generating graph: ${title}...\n`);

  // Load graph
  if (!fs.existsSync(GRAPH_PATH)) {
    console.error('Graph not found. Run: node neural-memory.js build');
    process.exit(1);
  }

  const fullGraph = msgpack.decode(fs.readFileSync(GRAPH_PATH));
  const sessionToProject = loadSessionProjects();

  // Get all projects with their concept counts (for the selector)
  const projectsList = getProjectsWithConcepts(fullGraph, sessionToProject);

  let graph = fullGraph;

  // Filter by project if specified
  if (projectFilter) {
    graph = filterGraphByProject(fullGraph, projectFilter, sessionToProject);

    if (Object.keys(graph.nodes).length === 0) {
      console.error(`No concepts found for project: ${projectFilter}`);
      process.exit(1);
    }
  }

  // Prepare nodes and edges for vis.js
  const nodes = [];
  const edges = [];
  const nodeIds = new Map();

  // Create nodes
  let id = 1;
  for (const [concept, data] of Object.entries(graph.nodes)) {
    if (!concept) continue; // Skip empty

    nodeIds.set(concept, id);

    // Size based on weight (session count)
    const size = Math.min(10 + data.w * 3, 50);

    // Color based on weight
    let color;
    if (data.w >= 5) color = '#e74c3c'; // Red - hot
    else if (data.w >= 3) color = '#f39c12'; // Orange - warm
    else if (data.w >= 2) color = '#3498db'; // Blue - normal
    else color = '#95a5a6'; // Gray - cold

    nodes.push({
      id: id,
      label: concept,
      value: data.w,
      size: size,
      color: color,
      title: `${concept}\n${data.w} sessions`
    });

    id++;
  }

  // Create edges
  for (const [from, targets] of Object.entries(graph.edges)) {
    const fromId = nodeIds.get(from);
    if (!fromId) continue;

    for (const target of targets) {
      const toId = nodeIds.get(target.c);
      if (!toId) continue;

      // Avoid duplicate edges
      const edgeKey = fromId < toId ? `${fromId}-${toId}` : `${toId}-${fromId}`;
      if (edges.find(e => e.key === edgeKey)) continue;

      edges.push({
        key: edgeKey,
        from: fromId,
        to: toId,
        value: target.w,
        title: `${target.w} shared sessions`
      });
    }
  }

  console.log(`  Nodes: ${nodes.length}`);
  console.log(`  Edges: ${edges.length}`);

  // Build concept-to-projects mapping for client-side filtering
  const conceptProjects = {};
  for (const [concept, data] of Object.entries(fullGraph.nodes)) {
    conceptProjects[concept] = [...new Set(
      (data.s || []).map(sid => sessionToProject[sid]).filter(Boolean)
    )];
  }

  // Map node IDs to concepts for filtering
  const nodeIdToConcept = {};
  for (const node of nodes) {
    nodeIdToConcept[node.id] = node.label;
  }

  // Determine output path
  const finalOutputPath = outputPath || path.join(MEMEX_PATH, projectFilter ? `graph-${projectFilter.toLowerCase()}.html` : 'graph.html');

  // Generate HTML
  const html = `<!DOCTYPE html>
<html>
<head>
  <title>Neural Memory - ${title}</title>
  <script src="https://unpkg.com/vis-network/standalone/umd/vis-network.min.js"></script>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      background: #1a1a2e;
      color: #eee;
    }
    #header {
      padding: 15px 20px;
      background: #16213e;
      display: flex;
      justify-content: space-between;
      align-items: center;
      gap: 20px;
    }
    #header h1 {
      font-size: 18px;
      font-weight: 500;
    }
    #header .controls {
      display: flex;
      align-items: center;
      gap: 15px;
    }
    #header .stats {
      font-size: 13px;
      color: #888;
    }
    #projectSelector {
      background: #1a1a2e;
      border: 1px solid #333;
      color: #eee;
      padding: 6px 12px;
      border-radius: 4px;
      font-size: 13px;
      cursor: pointer;
    }
    #projectSelector:focus {
      outline: none;
      border-color: #3498db;
    }
    #projectSelector option {
      background: #1a1a2e;
    }
    #graph {
      width: 100%;
      height: calc(100vh - 60px);
    }
    #legend {
      position: absolute;
      bottom: 20px;
      left: 20px;
      background: rgba(22, 33, 62, 0.9);
      padding: 15px;
      border-radius: 8px;
      font-size: 12px;
    }
    #legend div {
      display: flex;
      align-items: center;
      margin: 5px 0;
    }
    #legend span {
      width: 12px;
      height: 12px;
      border-radius: 50%;
      margin-right: 8px;
    }
    #search {
      position: absolute;
      top: 70px;
      right: 20px;
      background: rgba(22, 33, 62, 0.9);
      padding: 10px;
      border-radius: 8px;
    }
    #search input {
      background: #1a1a2e;
      border: 1px solid #333;
      color: #eee;
      padding: 8px 12px;
      border-radius: 4px;
      width: 200px;
    }
    #search input:focus {
      outline: none;
      border-color: #3498db;
    }
  </style>
</head>
<body>
  <div id="header">
    <h1>🧠 Neural Memory</h1>
    <div class="controls">
      <select id="projectSelector">
        <option value="">All Projects</option>
        ${projectsList.map(p => `<option value="${p.name}">${p.name} (${p.conceptCount})</option>`).join('\n        ')}
      </select>
      <div class="stats" id="stats">${nodes.length} concepts · ${edges.length} connections</div>
    </div>
  </div>
  <div id="graph"></div>
  <div id="legend">
    <div><span style="background:#e74c3c"></span> Hot (5+ sessions)</div>
    <div><span style="background:#f39c12"></span> Warm (3-4 sessions)</div>
    <div><span style="background:#3498db"></span> Normal (2 sessions)</div>
    <div><span style="background:#95a5a6"></span> Cold (1 session)</div>
  </div>
  <div id="search">
    <input type="text" id="searchInput" placeholder="Search concept..." />
  </div>

  <script>
    // Full data
    const allNodes = ${JSON.stringify(nodes)};
    const allEdges = ${JSON.stringify(edges.map(e => ({ from: e.from, to: e.to, value: e.value, title: e.title })))};
    const conceptProjects = ${JSON.stringify(conceptProjects)};
    const nodeIdToConcept = ${JSON.stringify(nodeIdToConcept)};

    // Current filtered data
    let nodes = new vis.DataSet(allNodes);
    let edges = new vis.DataSet(allEdges);

    const container = document.getElementById('graph');
    let data = { nodes, edges };

    const options = {
      nodes: {
        shape: 'dot',
        font: {
          color: '#eee',
          size: 12
        },
        borderWidth: 2,
        shadow: true
      },
      edges: {
        color: { color: '#444', highlight: '#3498db' },
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

    let network = new vis.Network(container, data, options);

    // TODO(human): Implement filterByProject function
    // This function should filter nodes and edges to show only concepts
    // belonging to the selected project, then rebuild the network.
    //
    // Parameters:
    //   projectName: string (empty string means "All Projects")
    //
    // Available data:
    //   - allNodes: array of {id, label, value, size, color, title}
    //   - allEdges: array of {from, to, value, title}
    //   - conceptProjects: { conceptName: [project1, project2, ...] }
    //   - nodeIdToConcept: { nodeId: conceptName }
    //
    // Steps to implement:
    //   1. If projectName is empty, show all nodes/edges
    //   2. Otherwise, filter allNodes to keep only those where
    //      conceptProjects[label].includes(projectName)
    //   3. Filter allEdges to keep only those where both from/to
    //      nodes are in the filtered set
    //   4. Update the stats display with new counts
    //   5. Rebuild the network with filtered data
    function filterByProject(projectName) {
      // Your implementation here
      console.log('Filter by project:', projectName || 'All');
    }

    // Project selector
    document.getElementById('projectSelector').addEventListener('change', function(e) {
      filterByProject(e.target.value);
    });

    // Search functionality
    document.getElementById('searchInput').addEventListener('input', function(e) {
      const query = e.target.value.toLowerCase();
      if (!query) {
        nodes.forEach(node => nodes.update({ id: node.id, opacity: 1, font: { color: '#eee' } }));
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

    // Click to focus
    network.on('click', function(params) {
      if (params.nodes.length > 0) {
        network.focus(params.nodes[0], { scale: 1.5, animation: true });
      }
    });
  </script>
</body>
</html>`;

  fs.writeFileSync(finalOutputPath, html);
  console.log(`\n✅ Generated: ${finalOutputPath}`);

  return finalOutputPath;
}

/**
 * Deploy global graph.html to all repos
 */
function deployGraphToRepos() {
  console.log('🚀 Deploying graph.html to all repositories...\n');

  // Generate global graph first
  const globalGraphPath = generateVisualization({ outputPath: path.join(MEMEX_PATH, 'graph.html') });

  // Use REPO_MAP for deployment
  const repos = Object.entries(REPO_MAP).map(([name, repoPath]) => ({ name, path: repoPath }));

  // Copy graph.html to each repo's .neural folder
  const graphHtml = fs.readFileSync(globalGraphPath, 'utf8');
  let deployed = 0;

  for (const repo of repos) {
    const neuralDir = path.join(repo.path, '.neural');
    const targetPath = path.join(neuralDir, 'graph.html');

    try {
      // Create .neural if it doesn't exist
      if (!fs.existsSync(neuralDir)) {
        fs.mkdirSync(neuralDir, { recursive: true });
      }

      fs.writeFileSync(targetPath, graphHtml);
      console.log(`✅ ${repo.name}: ${targetPath}`);
      deployed++;
    } catch (e) {
      console.log(`❌ ${repo.name}: ${e.message}`);
    }
  }

  console.log(`\n✅ Deployed to ${deployed} repos`);
}

// CLI
const args = process.argv.slice(2);
const noOpen = args.includes('--no-open');
const deployMode = args.includes('--deploy');

// Parse --project flag
let projectFilter = null;
const projectIdx = args.indexOf('--project');
if (projectIdx !== -1 && args[projectIdx + 1]) {
  projectFilter = args[projectIdx + 1];
}

if (deployMode) {
  deployGraphToRepos();
} else {
  const outputPath = generateVisualization({ projectFilter });

  if (!noOpen) {
    console.log('📂 Opening in browser...');
    try {
      execSync(`open "${outputPath}"`);
    } catch (e) {
      console.log(`   Open manually: file://${outputPath}`);
    }
  }
}
