'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const Database = require('better-sqlite3');
const { runSqlMigrations } = require('../scripts/migrations');
const { _createForTesting } = require('../scripts/ledger');
const { _createForTesting: createSentinel } = require('../scripts/contradiction-sentinel');
const { _createRegistry } = require('../scripts/verification-hooks');
const { computeScore, rankAssertions } = require('../scripts/rank');

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeTestLedger() {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  runSqlMigrations(db);
  return _createForTesting(db);
}

function makeAssertion(ledger, overrides = {}) {
  return ledger.createAssertion({
    plane: overrides.plane ?? 'project:test',
    class_: overrides.class_ ?? 'monotonic',
    claim: overrides.claim ?? 'The sky is blue',
    confidence: overrides.confidence ?? 0.8,
    staleness_model: overrides.staleness_model ?? 'flat',
    source_spans: overrides.source_spans ?? ['session:001'],
    density_hint: overrides.density_hint ?? 'terse',
  });
}

// ---------------------------------------------------------------------------
// contradiction-sentinel tests
// ---------------------------------------------------------------------------

describe('contradiction-sentinel: scanPlane finds no tensions in clean plane', async () => {
  it('returns tensions_found === 0 for two unrelated assertions', async () => {
    const ledger = makeTestLedger();
    makeAssertion(ledger, { claim: 'The sky is blue' });
    makeAssertion(ledger, { claim: 'The grass is green' });

    const sentinel = createSentinel(ledger);
    const result = await sentinel.scanPlane('project:test');
    assert.equal(result.tensions_found, 0);
  });
});

describe('contradiction-sentinel: scanPlane seeds tension for negation pair', async () => {
  it('detects "X is blue" vs "X is not blue" as a tension', async () => {
    const ledger = makeTestLedger();
    makeAssertion(ledger, { claim: 'The sky is blue' });
    makeAssertion(ledger, { claim: 'The sky is not blue' });

    const sentinel = createSentinel(ledger);
    const result = await sentinel.scanPlane('project:test');
    assert.equal(result.tensions_found, 1);

    // Confirm tension_pair was actually seeded
    const tensions = ledger.queryTensions();
    assert.equal(tensions.length, 1);
  });
});

describe('contradiction-sentinel: scanPlane is idempotent — second scan finds no new tensions', async () => {
  it('second scan returns tensions_found based on pairs found (idempotent link storage)', async () => {
    const ledger = makeTestLedger();
    makeAssertion(ledger, { claim: 'The sky is blue' });
    makeAssertion(ledger, { claim: 'The sky is not blue' });

    const sentinel = createSentinel(ledger);
    const r1 = await sentinel.scanPlane('project:test');
    assert.equal(r1.tensions_found, 1);

    // Second scan: detectNegation still fires, linkSupersession uses INSERT OR IGNORE
    // tensions_found counts pairs detected (not new DB rows), consistent with spec
    const r2 = await sentinel.scanPlane('project:test');
    assert.equal(r2.tensions_found, 1);

    // Still only one tension_pair row (idempotent)
    const tensions = ledger.queryTensions();
    assert.equal(tensions.length, 1);
  });
});

// ---------------------------------------------------------------------------
// verification-hooks tests
// ---------------------------------------------------------------------------

describe('verification-hooks: register and get', () => {
  it('registers a function and retrieves it by category', () => {
    const hooks = _createRegistry();
    const fn = async () => ({ verified: true });
    hooks.register('project', fn);
    assert.equal(hooks.get('project'), fn);
  });
});

describe('verification-hooks: get returns null for unknown category', () => {
  it('returns null when no hook is registered for the category', () => {
    const hooks = _createRegistry();
    assert.equal(hooks.get('unknown'), null);
  });
});

describe('verification-hooks: runPending calls hook for stale state_bound assertion', async () => {
  it('calls hook and invokes onVerified for a stale state_bound assertion', async () => {
    const hooks = _createRegistry();
    hooks.register('project', async () => ({ verified: true }));

    const staleDate = new Date(Date.now() - 20 * 24 * 60 * 60 * 1000).toISOString(); // 20 days ago
    const assertion = {
      id: 'a_test_001',
      plane: 'project:test',
      staleness_model: 'state_bound',
      last_verified: null,
      created_at: staleDate,
    };

    const verified = [];
    const results = await hooks.runPending([assertion], {
      staleDays: 14,
      onVerified: (id) => verified.push(id),
    });

    assert.equal(results.length, 1);
    assert.equal(results[0].status, 'verified');
    assert.deepEqual(verified, ['a_test_001']);
  });
});

describe('verification-hooks: runPending skips non-state_bound assertions', async () => {
  it('produces no results for flat staleness_model assertions', async () => {
    const hooks = _createRegistry();
    hooks.register('project', async () => ({ verified: true }));

    const assertion = {
      id: 'a_test_002',
      plane: 'project:test',
      staleness_model: 'flat',
      last_verified: null,
      created_at: new Date(Date.now() - 20 * 24 * 60 * 60 * 1000).toISOString(),
    };

    const results = await hooks.runPending([assertion], { staleDays: 14 });
    assert.equal(results.length, 0);
  });
});

describe('verification-hooks: runPending skips recently-verified assertions', async () => {
  it('skips assertion verified within staleDays window', async () => {
    const hooks = _createRegistry();
    hooks.register('project', async () => ({ verified: true }));

    const recentDate = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000).toISOString(); // 3 days ago
    const assertion = {
      id: 'a_test_003',
      plane: 'project:test',
      staleness_model: 'state_bound',
      last_verified: recentDate,
      created_at: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString(),
    };

    const results = await hooks.runPending([assertion], { staleDays: 14 });
    assert.equal(results.length, 0);
  });
});

// ---------------------------------------------------------------------------
// rank: counterfactual weight tests
// ---------------------------------------------------------------------------

describe('rank: counterfactual weight > 1 raises score (capped at 2.0)', () => {
  it('score with weight 2.0 is capped at 2.0', () => {
    const assertion = {
      id: 'a_1',
      staleness_model: 'flat',
      confidence: 0.8,
      status: 'established',
      quorum_count: 5,
      created_at: new Date().toISOString(),
    };
    const tensionIds = new Set();
    const now = new Date();
    const ctx = {};

    const baseScore = computeScore(assertion, tensionIds, now, ctx, undefined);
    const weightedScore = computeScore(assertion, tensionIds, now, ctx, 2.0);

    assert.ok(baseScore > 0, 'base score should be positive');
    assert.ok(weightedScore <= 2.0, 'score with weight > 1 must be capped at 2.0');
    assert.ok(weightedScore > baseScore, 'weight > 1 must raise score above base');
  });
});

describe('rank: counterfactual weight 0 zeroes out score', () => {
  it('score with weight 0 is exactly 0', () => {
    const assertion = {
      id: 'a_2',
      staleness_model: 'flat',
      confidence: 0.9,
      status: 'established',
      quorum_count: 5,
      created_at: new Date().toISOString(),
    };
    const tensionIds = new Set();
    const score = computeScore(assertion, tensionIds, new Date(), {}, 0);
    assert.equal(score, 0);
  });
});

describe('rank: rankAssertions uses counterfactualWeights map', () => {
  it('assertion with weight 2.0 ranks first even with lower base confidence', () => {
    const now = new Date();
    const high = {
      id: 'a_high',
      staleness_model: 'flat',
      confidence: 0.9,
      status: 'established',
      quorum_count: 5,
      created_at: now.toISOString(),
    };
    const low = {
      id: 'a_low',
      staleness_model: 'flat',
      confidence: 0.3,
      status: 'established',
      quorum_count: 5,
      created_at: now.toISOString(),
    };

    // Without weight: high ranks first
    const unweighted = rankAssertions([high, low], { now });
    assert.equal(unweighted[0].id, 'a_high');

    // With weight 4.0 on the low-confidence one: min(1.0, 0.3 * 4.0) = 1.0 > 0.9 → ranks first
    const weights = new Map([['a_low', 4.0]]);
    const weighted = rankAssertions([high, low], { now, counterfactualWeights: weights });
    assert.equal(weighted[0].id, 'a_low');
  });
});

// ---------------------------------------------------------------------------
// ledger: markVerified tests
// ---------------------------------------------------------------------------

describe('ledger: markVerified updates last_verified timestamp', () => {
  it('sets last_verified after calling markVerified', () => {
    const ledger = makeTestLedger();
    const id = makeAssertion(ledger);

    const before = ledger.getAssertion(id);
    assert.equal(before.last_verified, null);

    ledger.markVerified(id);

    const after = ledger.getAssertion(id);
    assert.ok(after.last_verified !== null, 'last_verified should be set');
    assert.ok(typeof after.last_verified === 'string');
    assert.ok(new Date(after.last_verified).getTime() > 0, 'last_verified should be a valid date');
  });

  it('throws if assertion does not exist', () => {
    const ledger = makeTestLedger();
    assert.throws(
      () => ledger.markVerified('nonexistent_id'),
      /markVerified: assertion not found/
    );
  });
});

// ---------------------------------------------------------------------------
// ledger: rankActive applies counterfactual weights
// ---------------------------------------------------------------------------

describe('ledger: rankActive applies counterfactual weights', () => {
  it('assertion with weight 0.01 scores below tentative unweighted assertion', () => {
    const ledger = makeTestLedger();

    // Create an established assertion with high confidence, then weight it down
    const establishedId = makeAssertion(ledger, {
      claim: 'Established high-confidence claim',
      confidence: 0.95,
    });
    // Promote to established by reinforcing
    ledger.reinforceAssertion(establishedId, { source_span: 'session:002' });
    ledger.maybePromote(establishedId);

    // Create a tentative assertion with moderate confidence (no weight)
    const tentativeId = makeAssertion(ledger, {
      claim: 'Tentative moderate claim',
      confidence: 0.5,
    });

    // Without weight: established high-confidence ranks first
    const unweighted = ledger.rankActive('project:test');
    assert.equal(unweighted[0].id, establishedId);

    // Apply near-zero weight to the established assertion
    ledger.setCounterfactualWeight(establishedId, 0.01);

    const weighted = ledger.rankActive('project:test');
    assert.equal(weighted[0].id, tentativeId, 'tentative should rank first when established is weighted down');
  });
});
