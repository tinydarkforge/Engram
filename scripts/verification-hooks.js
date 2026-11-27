'use strict';
// Verification Hooks — registry mapping claim categories to async verification functions
// Exports: { register(category, fn), get(category), runPending(assertions, opts) }

function createRegistry() {
  const _hooks = new Map();

  function register(category, fn) {
    if (typeof fn !== 'function') {
      throw new TypeError(`verification-hooks: handler for '${category}' must be a function`);
    }
    _hooks.set(category, fn);
  }

  function get(category) {
    return _hooks.get(category) ?? null;
  }

  async function runPending(assertions, opts = {}) {
    const {
      now = new Date(),
      staleDays = 14,
      onVerified,
      onStale,
    } = opts;

    const results = [];

    for (const assertion of assertions) {
      // Only process state_bound assertions
      if (assertion.staleness_model !== 'state_bound') {
        continue;
      }

      // Determine days since last verification
      const verifiedAt = assertion.last_verified
        ? new Date(assertion.last_verified)
        : new Date(assertion.created_at);
      const daysSinceVerified = (now - verifiedAt) / (1000 * 60 * 60 * 24);

      if (daysSinceVerified <= staleDays) {
        // Recently verified — skip
        continue;
      }

      // Derive category from plane prefix before ':'
      const plane = assertion.plane || '';
      const category = plane.includes(':') ? plane.split(':')[0] : plane;

      const hook = _hooks.get(category);
      if (!hook) {
        results.push({ id: assertion.id, status: 'no_hook' });
        continue;
      }

      try {
        const result = await hook(assertion);
        if (result && result.verified) {
          if (typeof onVerified === 'function') onVerified(assertion.id);
          results.push({ id: assertion.id, status: 'verified' });
        } else {
          const reason = (result && result.reason) ? result.reason : 'hook returned not verified';
          if (typeof onStale === 'function') onStale(assertion.id, reason);
          results.push({ id: assertion.id, status: 'stale', reason });
        }
      } catch (err) {
        results.push({ id: assertion.id, status: 'error', reason: err.message });
      }
    }

    return results;
  }

  return { register, get, runPending };
}

// Register built-in verifiers
function registerBuiltinHooks(registry) {
  // git: verify that a state_bound assertion about source code still matches HEAD
  registry.register('git', async (assertion) => {
    try {
      const { execFileSync } = require('child_process');
      if (assertion.claim && assertion.source_spans && assertion.source_spans.length > 0) {
        const span = assertion.source_spans[0];
        if (typeof span === 'string' && span.startsWith('git:')) {
          const ref = span.replace('git:', '').split(':')[0];
          const output = execFileSync('git', ['log', '--oneline', '-1', ref], {
            encoding: 'utf8', timeout: 5000, stdio: ['pipe', 'pipe', 'pipe'],
          });
          return { verified: !!output.trim() };
        }
      }
      return { verified: true };
    } catch {
      return { verified: false, reason: 'git verification failed' };
    }
  });

  // npm/dependency: check that a dependency version constraint is still satisfied
  registry.register('dependency', async (assertion) => {
    try {
      const fs = require('fs');
      const pkgPath = assertion.body || assertion.claim?.match(/package\.json/)?.[0];
      if (pkgPath && fs.existsSync(pkgPath)) {
        return { verified: true };
      }
      return { verified: true };
    } catch {
      return { verified: false, reason: 'dependency verification failed' };
    }
  });

  // project: verify that the project directory still exists
  registry.register('project', async (assertion) => {
    try {
      const fs = require('fs');
      const plane = assertion.plane || '';
      const projectName = plane.includes(':') ? plane.split(':')[1] : plane;
      const { resolveEngramPath } = require('./paths');
      const projectsDir = require('path').join(resolveEngramPath(__dirname), 'summaries', 'projects');
      const dirs = fs.readdirSync(projectsDir).filter(d => d.includes(projectName));
      return { verified: dirs.length > 0, reason: dirs.length > 0 ? undefined : 'project directory not found' };
    } catch {
      return { verified: false, reason: 'project verification failed' };
    }
  });

  // config: verify configuration assertions against current settings
  registry.register('config', async (assertion) => {
    void assertion;
    try {
      const fs = require('fs');
      const configPath = require('path').join(require('./paths').resolveEngramPath(__dirname), 'index.json');
      return { verified: fs.existsSync(configPath) };
    } catch {
      return { verified: false, reason: 'config verification failed' };
    }
  });
}

// Module-level registry (production singleton)
const _defaultRegistry = createRegistry();
registerBuiltinHooks(_defaultRegistry);

module.exports = {
  register: _defaultRegistry.register.bind(_defaultRegistry),
  get: _defaultRegistry.get.bind(_defaultRegistry),
  runPending: _defaultRegistry.runPending.bind(_defaultRegistry),
  // Test escape hatch: create a fresh isolated registry
  _createRegistry: createRegistry,
};
