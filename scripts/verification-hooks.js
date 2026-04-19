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

// Module-level registry (production singleton)
const _defaultRegistry = createRegistry();

module.exports = {
  register: _defaultRegistry.register.bind(_defaultRegistry),
  get: _defaultRegistry.get.bind(_defaultRegistry),
  runPending: _defaultRegistry.runPending.bind(_defaultRegistry),
  // Test escape hatch: create a fresh isolated registry
  _createRegistry: createRegistry,
};
