(async () => {
  const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const { network, nodes } = await GraphShell.init('graph-canvas', '/api/graph', { reducedMotion: reduced });
  GraphShell.setupSearch(network, nodes, 'graph-search');
  GraphShell.restoreState('concepts', network);
  GraphShell.setupStateAutoSave('concepts', network);
})();
