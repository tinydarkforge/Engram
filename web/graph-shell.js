var GraphShell = (function () {
  function nodeColor(value) {
    if (value >= 5) return '#f85149';
    if (value >= 3) return '#d29922';
    if (value >= 2) return '#58a6ff';
    return '#8b949e';
  }

  function buildOptions(opts) {
    var reduced = opts && opts.reducedMotion;
    var base = {
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
      interaction: {
        hover: true,
        tooltipDelay: 100
      }
    };

    if (reduced) {
      base.physics = { enabled: false };
    } else {
      base.physics = {
        enabled: true,
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
      };
    }

    return base;
  }

  function setupSearch(network, nodes, inputId) {
    var input = document.getElementById(inputId);
    if (!input) return;

    input.addEventListener('input', function (e) {
      var query = e.target.value.toLowerCase();
      if (!query) {
        nodes.forEach(function (node) {
          nodes.update({ id: node.id, opacity: 1, font: { color: '#e6edf3' } });
        });
        return;
      }

      var firstMatch = null;
      nodes.forEach(function (node) {
        var match = node.label.toLowerCase().includes(query);
        nodes.update({
          id: node.id,
          opacity: match ? 1 : 0.2,
          font: { color: match ? '#ffffff' : '#555555' }
        });
        if (match && firstMatch === null) firstMatch = node.id;
      });

      if (firstMatch !== null) {
        network.focus(firstMatch, { scale: 1.5, animation: true });
      }
    });
  }

  function saveState(pageId, network) {
    try {
      var scale = network.getScale();
      var position = network.getViewPosition();
      localStorage.setItem('graphShell.' + pageId, JSON.stringify({ scale: scale, position: position }));
    } catch (_) {}
  }

  function restoreState(pageId, network) {
    try {
      var raw = localStorage.getItem('graphShell.' + pageId);
      if (!raw) return;
      var state = JSON.parse(raw);
      if (state.scale && state.position) {
        network.moveTo({ position: state.position, scale: state.scale });
      }
    } catch (_) {}
  }

  function setupStateAutoSave(pageId, network) {
    network.on('dragEnd', function () { saveState(pageId, network); });
    network.on('zoom', function () { saveState(pageId, network); });
  }

  async function init(containerId, apiUrl, opts) {
    var container = document.getElementById(containerId);
    container.innerHTML = '<div style="padding:40px;color:#8b949e;text-align:center">Loading graph...</div>';

    var res = await fetch(apiUrl);
    var data = await res.json();

    var nodes = new vis.DataSet(data.nodes || []);
    var edges = new vis.DataSet(data.edges || []);
    var options = buildOptions(opts);
    var network = new vis.Network(container, { nodes: nodes, edges: edges }, options);

    return { network: network, nodes: nodes, edges: edges };
  }

  return {
    init: init,
    buildOptions: buildOptions,
    setupSearch: setupSearch,
    saveState: saveState,
    restoreState: restoreState,
    setupStateAutoSave: setupStateAutoSave,
    nodeColor: nodeColor
  };
})();
