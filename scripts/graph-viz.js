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
const CIRRUS_PATH = path.join(process.env.HOME, 'code/cirrus');
const GRAPH_PATH = path.join(MEMEX_PATH, '.neural', 'graph.msgpack');

// Known repositories (same as deploy-neural.js)
const REPO_MAP = {
  'CirrusTranslate': path.join(CIRRUS_PATH, 'CirrusTranslate'),
  'translate.hellocirrus': path.join(CIRRUS_PATH, 'translatehellocirrus'),
  'DevOps': path.join(CIRRUS_PATH, 'DevOps'),
  'Memex': path.join(CIRRUS_PATH, 'DevOps/Memex'),
  'MIRAGE': path.join(CIRRUS_PATH, 'MIRAGE'),
  'Aither': path.join(CIRRUS_PATH, 'Aither'),
  'CLEAR-Render': path.join(CIRRUS_PATH, 'CLEAR-Render'),
  'FORGE': path.join(CIRRUS_PATH, 'FORGE')
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

  let graph = msgpack.decode(fs.readFileSync(GRAPH_PATH));

  // Filter by project if specified
  if (projectFilter) {
    const sessionToProject = loadSessionProjects();
    graph = filterGraphByProject(graph, projectFilter, sessionToProject);

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
    }
    #header h1 {
      font-size: 18px;
      font-weight: 500;
    }
    #header .stats {
      font-size: 13px;
      color: #888;
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
    <h1>🧠 Neural Memory - ${title}</h1>
    <div class="stats">${nodes.length} concepts · ${edges.length} connections</div>
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
    const nodes = new vis.DataSet(${JSON.stringify(nodes)});
    const edges = new vis.DataSet(${JSON.stringify(edges.map(e => ({ from: e.from, to: e.to, value: e.value, title: e.title })))});

    const container = document.getElementById('graph');
    const data = { nodes, edges };

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

    const network = new vis.Network(container, data, options);

    // Search functionality
    document.getElementById('searchInput').addEventListener('input', function(e) {
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
