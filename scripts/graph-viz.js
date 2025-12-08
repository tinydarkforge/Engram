#!/usr/bin/env node

/**
 * Graph Visualization - Generate interactive HTML concept map
 *
 * Usage:
 *   node graph-viz.js              Generate and open graph.html
 *   node graph-viz.js --no-open    Generate without opening
 */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const msgpack = require('msgpack-lite');

const MEMEX_PATH = process.env.MEMEX_PATH || path.join(process.env.HOME, 'code/cirrus/DevOps/Memex');
const GRAPH_PATH = path.join(MEMEX_PATH, '.neural', 'graph.msgpack');
const OUTPUT_PATH = path.join(MEMEX_PATH, 'graph.html');

function generateVisualization() {
  console.log('🎨 Generating graph visualization...\n');

  // Load graph
  if (!fs.existsSync(GRAPH_PATH)) {
    console.error('Graph not found. Run: node neural-memory.js build');
    process.exit(1);
  }

  const graph = msgpack.decode(fs.readFileSync(GRAPH_PATH));

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

  // Generate HTML
  const html = `<!DOCTYPE html>
<html>
<head>
  <title>Neural Memory - Concept Graph</title>
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
    <h1>🧠 Neural Memory - Concept Graph</h1>
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

  fs.writeFileSync(OUTPUT_PATH, html);
  console.log(`\n✅ Generated: ${OUTPUT_PATH}`);

  return OUTPUT_PATH;
}

// CLI
const noOpen = process.argv.includes('--no-open');
const outputPath = generateVisualization();

if (!noOpen) {
  console.log('📂 Opening in browser...');
  try {
    execSync(`open "${outputPath}"`);
  } catch (e) {
    console.log(`   Open manually: file://${outputPath}`);
  }
}
