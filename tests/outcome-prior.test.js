'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const Database = require('better-sqlite3');
const { runSqlMigrations } = require('../scripts/migrations');
const { _createForTesting } = require('../scripts/ledger');
const { computeOutcomePriors, MIN_EVENTS } = require('../scripts/feedback/outcome-prior');
const { computeScore, rankAssertions } = require('../scripts/rank');

function makeDb() {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  runSqlMigrations(db);
  return db;
}

function makeTestLedger() {
  const db = makeDb();
  return { ledger: _createForTesting(db), db };
}

function insertOutcomes(db, assertionId, scores) {
  const insert = db.prepare(`
    INSERT INTO assertion_outcomes
      (id, assertion_id, session_id, selected_at, signal_source, score)
    VALUES (?, ?, ?, ?, 'post_hoc', ?)
  `);
  db.transaction(() => {
    for (let i = 0; i < scores.length; i++) {
      insert.run(`ao_${assertionId}_${i}`, assertionId, `sess:${i}`, new Date().toISOString(), scores[i]);
    }
  })();
}

function makeAssertion(overrides = {}) {
  return {
    id: 'a1',
    staleness_model: 'flat',
    status: 'established',
    confidence: 0.8,
    quorum_count: 5,
    last_verified: null,
    ...overrides,
  };
}

describe('computeOutcomePriors', () => {
  it('returns empty Map for empty assertionIds', () => {
    const db = makeDb();
    const result = computeOutcomePriors(db, []);
    assert.equal(result.size, 0);
    db.close();
  });

  it('returns empty Map when db is null', () => {
    const result = computeOutcomePriors(null, ['a1', 'a2']);
    assert.equal(result.size, 0);
  });

  it('returns empty Map when db is undefined', () => {
    const result = computeOutcomePriors(undefined, ['a1']);
    assert.equal(result.size, 0);
  });

  it('returns 1.0 (neutral) for assertions with < MIN_EVENTS outcomes (cold start)', () => {
    const { ledger, db } = makeTestLedger();
    const aid = ledger.createAssertion({
      plane: 'user:x', class_: 'monotonic', claim: 'cold claim',
      source_spans: ['s:1'],
    });

    // Insert fewer than MIN_EVENTS rows
    insertOutcomes(db, aid, Array(MIN_EVENTS - 1).fill(0.9));

    const priors = computeOutcomePriors(db, [aid]);
    assert.equal(priors.get(aid), 1.0);
    db.close();
  });

  it('returns avg*2 clamped to [0.1, 2.0] for assertions with >= MIN_EVENTS outcomes', () => {
    const { ledger, db } = makeTestLedger();
    const aid = ledger.createAssertion({
      plane: 'user:x', class_: 'monotonic', claim: 'warm claim',
      source_spans: ['s:1'],
    });

    // avg = 0.7 → prior = 1.4
    insertOutcomes(db, aid, Array(MIN_EVENTS).fill(0.7));

    const priors = computeOutcomePriors(db, [aid]);
    const prior = priors.get(aid);
    assert.ok(Math.abs(prior - 1.4) < 0.001, `expected ~1.4, got ${prior}`);
    db.close();
  });

  it('high-scoring assertion gets prior > 1.0', () => {
    const { ledger, db } = makeTestLedger();
    const aid = ledger.createAssertion({
      plane: 'user:x', class_: 'monotonic', claim: 'high scorer',
      source_spans: ['s:1'],
    });

    // avg = 0.9 → prior = 1.8
    insertOutcomes(db, aid, Array(MIN_EVENTS).fill(0.9));

    const priors = computeOutcomePriors(db, [aid]);
    const prior = priors.get(aid);
    assert.ok(prior > 1.0, `expected > 1.0, got ${prior}`);
    assert.ok(prior <= 2.0, `expected <= 2.0, got ${prior}`);
    db.close();
  });

  it('low-scoring assertion gets prior < 1.0 but >= 0.1', () => {
    const { ledger, db } = makeTestLedger();
    const aid = ledger.createAssertion({
      plane: 'user:x', class_: 'monotonic', claim: 'low scorer',
      source_spans: ['s:1'],
    });

    // avg = 0.1 → prior = 0.2
    insertOutcomes(db, aid, Array(MIN_EVENTS).fill(0.1));

    const priors = computeOutcomePriors(db, [aid]);
    const prior = priors.get(aid);
    assert.ok(prior < 1.0, `expected < 1.0, got ${prior}`);
    assert.ok(prior >= 0.1, `expected >= 0.1, got ${prior}`);
    db.close();
  });

  it('assertions not in query result get 1.0', () => {
    const db = makeDb();
    // Use IDs that have no rows in assertion_outcomes
    const priors = computeOutcomePriors(db, ['nonexistent_1', 'nonexistent_2']);
    assert.equal(priors.get('nonexistent_1'), 1.0);
    assert.equal(priors.get('nonexistent_2'), 1.0);
    db.close();
  });

  it('clamps to 2.0 at maximum (avg=1.0 exactly)', () => {
    const { ledger, db } = makeTestLedger();
    const aid = ledger.createAssertion({
      plane: 'user:x', class_: 'monotonic', claim: 'max scorer',
      source_spans: ['s:1'],
    });

    insertOutcomes(db, aid, Array(MIN_EVENTS).fill(1.0));

    const priors = computeOutcomePriors(db, [aid]);
    assert.equal(priors.get(aid), 2.0);
    db.close();
  });

  it('clamps to 0.1 at minimum (avg near 0)', () => {
    const { ledger, db } = makeTestLedger();
    const aid = ledger.createAssertion({
      plane: 'user:x', class_: 'monotonic', claim: 'floor scorer',
      source_spans: ['s:1'],
    });

    insertOutcomes(db, aid, Array(MIN_EVENTS).fill(0.0));

    const priors = computeOutcomePriors(db, [aid]);
    assert.equal(priors.get(aid), 0.1);
    db.close();
  });
});

describe('computeScore with outcomePrior', () => {
  const now = new Date();

  it('outcomePrior=1.0 → same score as default (neutral)', () => {
    const a = makeAssertion();
    const baseline = computeScore(a, new Set(), now, {}, 1.0);
    const withNeutral = computeScore(a, new Set(), now, {}, 1.0, 1.0);
    assert.equal(baseline, withNeutral);
  });

  it('outcomePrior=1.5 → score is boosted (priorFactor = 1.1)', () => {
    const a = makeAssertion();
    const baseline = computeScore(a, new Set(), now, {}, 1.0, 1.0);
    const boosted = computeScore(a, new Set(), now, {}, 1.0, 1.5);
    // priorFactor for 1.5 = 1 + 0.2*(1.5-1) = 1.1
    assert.ok(boosted > baseline, `expected boosted (${boosted}) > baseline (${baseline})`);
    assert.ok(Math.abs(boosted / baseline - 1.1) < 0.001, `expected ~10% boost`);
  });

  it('outcomePrior=0.5 → score is reduced (priorFactor = 0.9)', () => {
    const a = makeAssertion();
    const baseline = computeScore(a, new Set(), now, {}, 1.0, 1.0);
    const reduced = computeScore(a, new Set(), now, {}, 1.0, 0.5);
    // priorFactor for 0.5 = 1 + 0.2*(0.5-1) = 0.9
    assert.ok(reduced < baseline, `expected reduced (${reduced}) < baseline (${baseline})`);
    assert.ok(Math.abs(reduced / baseline - 0.9) < 0.001, `expected ~10% reduction`);
  });

  it('omitting outcomePrior defaults to 1.0 (neutral)', () => {
    const a = makeAssertion();
    const explicit = computeScore(a, new Set(), now, {}, 1.0, 1.0);
    const implicit = computeScore(a, new Set(), now, {}, 1.0);
    assert.equal(explicit, implicit);
  });
});

describe('rankAssertions with outcomePriors', () => {
  it('ranking stable on assertions with < MIN_EVENTS events (cold-start — all priors 1.0, order unchanged)', () => {
    const now = new Date();
    const assertions = [
      makeAssertion({ id: 'high', confidence: 0.9, quorum_count: 5 }),
      makeAssertion({ id: 'mid',  confidence: 0.7, quorum_count: 3 }),
      makeAssertion({ id: 'low',  confidence: 0.5, quorum_count: 1 }),
    ];

    // Without priors
    const baseline = rankAssertions(assertions, { now });
    // With a map of all-neutral priors (cold-start)
    const coldPriors = new Map([['high', 1.0], ['mid', 1.0], ['low', 1.0]]);
    const withPriors = rankAssertions(assertions, { now, outcomePriors: coldPriors });

    const baselineIds = baseline.map(a => a.id);
    const withPriorsIds = withPriors.map(a => a.id);
    assert.deepEqual(baselineIds, withPriorsIds, 'cold-start priors must not change ordering');
  });

  it('outcomePriors boost causes re-ranking when spread is large', () => {
    const now = new Date();
    const assertions = [
      makeAssertion({ id: 'a', confidence: 0.6, quorum_count: 5 }),
      makeAssertion({ id: 'b', confidence: 0.5, quorum_count: 5 }),
    ];

    // Without priors: 'a' should rank above 'b'
    const baseline = rankAssertions(assertions, { now });
    assert.equal(baseline[0].id, 'a');

    // Give 'b' a very high prior and 'a' a low one — should flip
    const priors = new Map([['a', 0.1], ['b', 2.0]]);
    const reranked = rankAssertions(assertions, { now, outcomePriors: priors });
    assert.equal(reranked[0].id, 'b', 'high prior should lift b above a');
  });
});
