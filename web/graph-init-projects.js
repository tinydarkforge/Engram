(async () => {
  const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const container = document.getElementById('graph-canvas');

  const res = await fetch('/api/projects');
  const data = await res.json();
  const nodeList = (data.projects || []).map((p, i) => ({
    id: i + 1,
    label: p.name,
    value: p.sessions || 1,
    color: {
      background: GraphShell.nodeColor(p.sessions || 1),
      border: GraphShell.nodeColor(p.sessions || 1)
    },
    title: `${p.name}: ${p.sessions} sessions`
  }));

  const nodes = new vis.DataSet(nodeList);
  const edges = new vis.DataSet([]);
  const options = GraphShell.buildOptions({ reducedMotion: reduced });
  const network = new vis.Network(container, { nodes, edges }, options);

  GraphShell.setupSearch(network, nodes, 'graph-search');
  GraphShell.restoreState('projects', network);
  GraphShell.setupStateAutoSave('projects', network);
})();
