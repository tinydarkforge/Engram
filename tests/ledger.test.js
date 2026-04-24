#!/usr/bin/env node

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const Database = require('better-sqlite3');
const path = require('path');
const { runSqlMigrations } = require('../scripts/migrations');

describe('SQL Migrations', () => {
  it('applies 0001_ledger.sql cleanly to a fresh in-memory DB', () => {
    const db = new Database(':memory:');
    const result = runSqlMigrations(db);
    assert.ok(Array.isArray(result.applied), 'applied should be an array');
    assert.ok(result.applied.includes('0001_ledger.sql'), 'should apply 0001_ledger.sql');
    // Verify tables exist
    const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map(r => r.name);
    assert.ok(tables.includes('assertions'), 'assertions table should exist');
    assert.ok(tables.includes('supersession_edges'), 'supersession_edges table should exist');
    assert.ok(tables.includes('tension_pairs'), 'tension_pairs table should exist');
    assert.ok(tables.includes('schema_migrations'), 'schema_migrations table should exist');
    db.close();
  });

  it('is idempotent — running twice does not error', () => {
    const db = new Database(':memory:');
    const r1 = runSqlMigrations(db);
    const r2 = runSqlMigrations(db);
    assert.equal(r2.applied.length, 0, 'second run should apply nothing');
    assert.ok(r2.skipped.includes('0001_ledger.sql'), 'second run should skip already-applied');
    db.close();
  });
});

// ---------------------------------------------------------------------------
// Ledger CRUD tests
// ---------------------------------------------------------------------------
const { _createForTesting } = require('../scripts/ledger');

function makeTestLedger() {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  runSqlMigrations(db);
  return { ledger: _createForTesting(db), db };
}

describe('Ledger CRUD', () => {
  it('createAssertion → round-trip via getAssertion', () => {
    const { ledger } = makeTestLedger();

    const id = ledger.createAssertion({
      plane: 'user:daniel',
      class_: 'monotonic',
      claim: 'The sky is blue',
      body: 'Some body text',
      confidence: 0.8,
      source_spans: ['session:abc', 'session:def'],
      density_hint: 'verbose',
      cache_stable: 1,
    });

    assert.ok(id.startsWith('a_'), 'id should start with a_');

    const assertion = ledger.getAssertion(id);
    assert.ok(assertion !== null, 'should return the assertion');
    assert.equal(assertion.id, id);
    assert.equal(assertion.plane, 'user:daniel');
    assert.equal(assertion.class, 'monotonic');
    assert.equal(assertion.claim, 'The sky is blue');
    assert.equal(assertion.body, 'Some body text');
    assert.equal(assertion.confidence, 0.8);
    assert.equal(assertion.status, 'tentative');
    assert.equal(assertion.quorum_count, 1);
    assert.equal(assertion.density_hint, 'verbose');
    assert.equal(assertion.cache_stable, 1);

    assert.ok(Array.isArray(assertion.source_spans), 'source_spans should be an array');
    assert.equal(assertion.source_spans.length, 2);
    assert.ok(assertion.source_spans.includes('session:abc'));
    assert.ok(assertion.source_spans.includes('session:def'));

    assert.deepEqual(assertion.supersedes, []);
    assert.deepEqual(assertion.superseded_by, []);
  });

  it('createAssertion throws when required fields are missing', () => {
    const { ledger } = makeTestLedger();

    assert.throws(
      () => ledger.createAssertion({ class_: 'monotonic', claim: 'x', source_spans: ['s:1'] }),
      /plane is required/
    );
    assert.throws(
      () => ledger.createAssertion({ plane: 'p', claim: 'x', source_spans: ['s:1'] }),
      /class_ is required/
    );
    assert.throws(
      () => ledger.createAssertion({ plane: 'p', class_: 'monotonic', source_spans: ['s:1'] }),
      /claim is required/
    );
    assert.throws(
      () => ledger.createAssertion({ plane: 'p', class_: 'monotonic', claim: 'x', source_spans: [] }),
      /source_spans/
    );
  });

  it('reinforceAssertion increments quorum and updates last_reinforced', () => {
    const { ledger } = makeTestLedger();

    const id = ledger.createAssertion({
      plane: 'project:Codicil',
      class_: 'episodic',
      claim: 'Reinforcement works',
      source_spans: ['session:r1'],
    });

    ledger.reinforceAssertion(id, { source_span: 'session:r2', confidence_delta: 0.1 });

    const assertion = ledger.getAssertion(id);
    assert.equal(assertion.quorum_count, 2);
    assert.ok(assertion.last_reinforced !== null, 'last_reinforced should be set');
    // confidence started at 0.5, delta 0.1 → 0.6
    assert.ok(Math.abs(assertion.confidence - 0.6) < 0.001, `confidence should be ~0.6, got ${assertion.confidence}`);
    // new span should be recorded
    assert.ok(assertion.source_spans.includes('session:r2'));
  });

  it('reinforceAssertion throws when assertion not found', () => {
    const { ledger } = makeTestLedger();
    assert.throws(
      () => ledger.reinforceAssertion('a_0_notexist', { source_span: 's:x' }),
      /not found/
    );
  });

  it('maybePromote flips tentative → established at threshold', () => {
    const { ledger } = makeTestLedger();

    const id = ledger.createAssertion({
      plane: 'user:daniel',
      class_: 'state_bound',
      claim: 'Promotion test',
      source_spans: ['session:p1'],
    });

    // quorum_count = 1, threshold = 2 → should NOT promote
    const promoted1 = ledger.maybePromote(id, 2);
    assert.equal(promoted1, false);
    assert.equal(ledger.getAssertion(id).status, 'tentative');

    // reinforce to quorum_count = 2
    ledger.reinforceAssertion(id, { source_span: 'session:p2' });

    const promoted2 = ledger.maybePromote(id, 2);
    assert.equal(promoted2, true);
    assert.equal(ledger.getAssertion(id).status, 'established');

    // calling again on an already-established assertion returns false
    const promoted3 = ledger.maybePromote(id, 2);
    assert.equal(promoted3, false);
  });

  it('linkSupersession dominates excludes parent from queryActiveByPlane', () => {
    const { ledger } = makeTestLedger();

    const parentId = ledger.createAssertion({
      plane: 'project:Codicil',
      class_: 'monotonic',
      claim: 'Old claim',
      source_spans: ['session:s1'],
    });

    const childId = ledger.createAssertion({
      plane: 'project:Codicil',
      class_: 'monotonic',
      claim: 'New claim supersedes old',
      source_spans: ['session:s2'],
    });

    ledger.linkSupersession(childId, parentId, 'dominates');

    // child supersedes parent
    const child = ledger.getAssertion(childId);
    assert.equal(child.supersedes.length, 1);
    assert.equal(child.supersedes[0].id, parentId);
    assert.equal(child.supersedes[0].kind, 'dominates');

    const parent = ledger.getAssertion(parentId);
    assert.equal(parent.superseded_by.length, 1);
    assert.equal(parent.superseded_by[0].id, childId);

    // active query must include child but exclude parent
    const active = ledger.queryActiveByPlane('project:Codicil');
    const ids = active.map(a => a.id);
    assert.ok(ids.includes(childId), 'child should be active');
    assert.ok(!ids.includes(parentId), 'dominated parent should be excluded');
  });

  it('linkSupersession contradicts creates tension_pair', () => {
    const { ledger } = makeTestLedger();

    const idA = ledger.createAssertion({
      plane: 'user:daniel',
      class_: 'contextual',
      claim: 'Claim A',
      source_spans: ['session:c1'],
    });

    const idB = ledger.createAssertion({
      plane: 'user:daniel',
      class_: 'contextual',
      claim: 'Claim B contradicts A',
      source_spans: ['session:c2'],
    });

    ledger.linkSupersession(idB, idA, 'contradicts');

    const tensions = ledger.queryTensions({ resolved: false });
    assert.equal(tensions.length, 1);
    assert.equal(tensions[0].a_id, idB);
    assert.equal(tensions[0].b_id, idA);
    assert.ok(tensions[0].resolved_at === null);

    // calling again should not create a duplicate
    ledger.linkSupersession(idB, idA, 'contradicts');
    const tensionsAfter = ledger.queryTensions({ resolved: false });
    assert.equal(tensionsAfter.length, 1);
  });

  it('queryActiveByPlane scoped by plane and class', () => {
    const { ledger } = makeTestLedger();

    ledger.createAssertion({ plane: 'project:Alpha', class_: 'monotonic', claim: 'Alpha mono 1', source_spans: ['s:1'] });
    ledger.createAssertion({ plane: 'project:Alpha', class_: 'episodic',  claim: 'Alpha epi 1',  source_spans: ['s:2'] });
    ledger.createAssertion({ plane: 'project:Beta',  class_: 'monotonic', claim: 'Beta mono 1',  source_spans: ['s:3'] });

    const allAlpha = ledger.queryActiveByPlane('project:Alpha');
    assert.equal(allAlpha.length, 2);

    const monoAlpha = ledger.queryActiveByPlane('project:Alpha', { classes: ['monotonic'] });
    assert.equal(monoAlpha.length, 1);
    assert.equal(monoAlpha[0].claim, 'Alpha mono 1');

    const betaResults = ledger.queryActiveByPlane('project:Beta');
    assert.equal(betaResults.length, 1);
    assert.equal(betaResults[0].plane, 'project:Beta');
  });

  it('markFossilized flips status', () => {
    const { ledger } = makeTestLedger();

    const id = ledger.createAssertion({
      plane: 'user:daniel',
      class_: 'monotonic',
      claim: 'Will be fossilized',
      source_spans: ['session:f1'],
    });

    ledger.markFossilized(id, 'outdated after review');
    assert.equal(ledger.getAssertion(id).status, 'fossilized');

    // should be excluded from active queries
    const active = ledger.queryActiveByPlane('user:daniel');
    assert.ok(!active.map(a => a.id).includes(id));

    // throws on unknown id
    assert.throws(() => ledger.markFossilized('a_0_unknown', 'x'), /not found/);
  });

  it('queryTensions returns unresolved pairs', () => {
    const { ledger } = makeTestLedger();

    const idA = ledger.createAssertion({
      plane: 'user:daniel', class_: 'contextual', claim: 'Tension A', source_spans: ['s:t1'],
    });
    const idB = ledger.createAssertion({
      plane: 'user:daniel', class_: 'contextual', claim: 'Tension B', source_spans: ['s:t2'],
    });
    const idC = ledger.createAssertion({
      plane: 'user:daniel', class_: 'contextual', claim: 'Tension C', source_spans: ['s:t3'],
    });

    ledger.linkSupersession(idB, idA, 'contradicts');
    ledger.linkSupersession(idC, idA, 'contradicts');

    const unresolved = ledger.queryTensions({ resolved: false });
    assert.equal(unresolved.length, 2);
    assert.ok(unresolved.every(t => t.resolved_at === null));

    const resolved = ledger.queryTensions({ resolved: true });
    assert.equal(resolved.length, 0);
  });

  it('stats returns correct counts', () => {
    const { ledger } = makeTestLedger();

    ledger.createAssertion({ plane: 'user:daniel', class_: 'monotonic', claim: 'S1', source_spans: ['s:1'] });
    const id2 = ledger.createAssertion({ plane: 'user:daniel', class_: 'episodic', claim: 'S2', source_spans: ['s:2'] });
    ledger.createAssertion({ plane: 'project:Alpha', class_: 'monotonic', claim: 'S3', source_spans: ['s:3'] });

    ledger.reinforceAssertion(id2, { source_span: 's:2b' });
    ledger.maybePromote(id2, 2);

    const s = ledger.stats();
    assert.equal(s.total, 3);
    assert.equal(s.by_status.tentative, 2);
    assert.equal(s.by_status.established, 1);
    assert.equal(s.by_plane['user:daniel'], 2);
    assert.equal(s.by_plane['project:Alpha'], 1);
    assert.equal(s.tensions_open, 0);
  });

  it('getAssertion returns null for unknown id', () => {
    const { ledger } = makeTestLedger();
    assert.equal(ledger.getAssertion('a_0_doesnotexist'), null);
  });
});

// ---------------------------------------------------------------------------
// dedup unit tests
// ---------------------------------------------------------------------------
const {
  tokenize,
  jaccardSimilarity,
  removeNegations,
  hasNegation,
  detectNegation,
  findNearDuplicate,
  findNegations,
} = require('../scripts/dedup');

describe('dedup', () => {
  it('tokenize returns expected tokens', () => {
    const tokens = tokenize('The sky is blue!');
    assert.ok(tokens instanceof Set);
    assert.ok(tokens.has('the'));
    assert.ok(tokens.has('sky'));
    assert.ok(tokens.has('is'));
    assert.ok(tokens.has('blue'));
    assert.equal(tokens.size, 4);
  });

  it('jaccardSimilarity: identical sets → 1.0', () => {
    const s = new Set(['a', 'b', 'c']);
    assert.equal(jaccardSimilarity(s, s), 1.0);
  });

  it('jaccardSimilarity: disjoint sets → 0.0', () => {
    assert.equal(jaccardSimilarity(new Set(['a', 'b']), new Set(['c', 'd'])), 0.0);
  });

  it('jaccardSimilarity: partial overlap → correct fraction', () => {
    const a = new Set(['a', 'b', 'c']);
    const b = new Set(['b', 'c', 'd']);
    // intersection: {b, c} = 2, union: {a, b, c, d} = 4 → 0.5
    assert.equal(jaccardSimilarity(a, b), 0.5);
  });

  it('detectNegation: "X is Y" vs "X is not Y" → true', () => {
    assert.equal(detectNegation('the sky is blue', 'the sky is not blue'), true);
  });

  it('detectNegation: two non-negating claims → false', () => {
    assert.equal(detectNegation('the sky is blue', 'the ocean is green'), false);
  });

  it('detectNegation: both claims contain negation words → false', () => {
    assert.equal(detectNegation('the sky is not green', 'the sky is not blue'), false);
  });

  it('findNearDuplicate: finds match above threshold', () => {
    const claims = [{ id: 'a_1', claim: 'the sky is blue' }];
    const result = findNearDuplicate(claims, 'sky is blue', 0.7);
    assert.ok(result !== null);
    assert.equal(result.id, 'a_1');
    assert.ok(result.similarity >= 0.7);
  });

  it('findNearDuplicate: returns null below threshold', () => {
    const claims = [{ id: 'a_1', claim: 'the sky is blue on a clear day in summer' }];
    const result = findNearDuplicate(claims, 'the ocean is deep', 0.7);
    assert.equal(result, null);
  });

  it('findNegations: returns correct ids', () => {
    const claims = [
      { id: 'a_1', claim: 'the sky is blue' },
      { id: 'a_2', claim: 'the ocean is deep' },
    ];
    const result = findNegations(claims, 'the sky is not blue', 0.7);
    assert.deepEqual(result, ['a_1']);
  });
});

// ---------------------------------------------------------------------------
// Ledger ingest integration tests
// ---------------------------------------------------------------------------
describe('Ledger ingest', () => {
  it('creates new assertion when no duplicate exists', () => {
    const { ledger } = makeTestLedger();
    const result = ledger.ingest({
      plane: 'project:Codicil',
      class_: 'monotonic',
      claim: 'The sky is blue',
      source_spans: ['session:s1'],
    });
    assert.equal(result.action, 'created');
    assert.ok(result.id.startsWith('a_'));
    assert.deepEqual(result.negations, []);
  });

  it('reinforces when a duplicate claim exists', () => {
    const { ledger } = makeTestLedger();
    const existingId = ledger.createAssertion({
      plane: 'project:Codicil',
      class_: 'monotonic',
      claim: 'the sky is blue',
      source_spans: ['session:s1'],
    });

    const result = ledger.ingest({
      plane: 'project:Codicil',
      class_: 'monotonic',
      claim: 'sky is blue',
      source_spans: ['session:s2'],
    });

    assert.equal(result.action, 'reinforced');
    assert.equal(result.id, existingId);
  });

  it('creates assertion and auto-links contradiction when negation detected', () => {
    const { ledger } = makeTestLedger();
    const existingId = ledger.createAssertion({
      plane: 'project:Codicil',
      class_: 'monotonic',
      claim: 'the sky is blue',
      source_spans: ['session:s1'],
    });

    const result = ledger.ingest({
      plane: 'project:Codicil',
      class_: 'monotonic',
      claim: 'the sky is not blue',
      source_spans: ['session:s2'],
    });

    assert.equal(result.action, 'created');
    assert.deepEqual(result.negations, [existingId]);

    const tensions = ledger.queryTensions({ resolved: false });
    assert.equal(tensions.length, 1);
  });

  it('near-duplicate does NOT create a new row', () => {
    const { ledger, db } = makeTestLedger();
    ledger.createAssertion({
      plane: 'project:Codicil',
      class_: 'monotonic',
      claim: 'the sky is blue',
      source_spans: ['session:s1'],
    });

    ledger.ingest({
      plane: 'project:Codicil',
      class_: 'monotonic',
      claim: 'sky is blue',
      source_spans: ['session:s2'],
    });

    const count = db.prepare("SELECT COUNT(*) AS n FROM assertions WHERE plane = 'project:Codicil'").get().n;
    assert.equal(count, 1);
  });
});

// ---------------------------------------------------------------------------
// rank unit tests
// ---------------------------------------------------------------------------
const { computeScore, rankAssertions, budgetCost, selectForContext: rankSelectForContext } = require('../scripts/rank');

function makeAssertion(overrides = {}) {
  return {
    id: 'a_test',
    plane: 'project:Test',
    class: 'monotonic',
    claim: 'hello world',
    body: null,
    confidence: 0.8,
    quorum_count: 1,
    status: 'tentative',
    created_at: new Date().toISOString(),
    last_reinforced: null,
    last_verified: null,
    staleness_model: 'flat',
    cache_stable: 0,
    density_hint: 'terse',
    ...overrides,
  };
}

describe('rank — computeScore', () => {
  it('established scores higher than tentative at same confidence', () => {
    const established = makeAssertion({ id: 'a_1', status: 'established' });
    const tentative = makeAssertion({ id: 'a_2', status: 'tentative' });
    const noTensions = new Set();
    const scoreE = computeScore(established, noTensions, new Date(), {});
    const scoreT = computeScore(tentative, noTensions, new Date(), {});
    assert.ok(scoreE > scoreT, `established (${scoreE}) should beat tentative (${scoreT})`);
  });

  it('tension penalty halves the score', () => {
    const a = makeAssertion({ id: 'a_1' });
    const scoreClean = computeScore(a, new Set(), new Date(), {});
    const scoreTense = computeScore(a, new Set(['a_1']), new Date(), {});
    assert.ok(Math.abs(scoreClean / scoreTense - 2.0) < 0.001, 'tension should halve score');
  });

  it('higher quorum_count yields higher score', () => {
    const low = makeAssertion({ id: 'a_1', quorum_count: 1 });
    const high = makeAssertion({ id: 'a_2', quorum_count: 5 });
    const noTensions = new Set();
    assert.ok(
      computeScore(high, noTensions, new Date(), {}) > computeScore(low, noTensions, new Date(), {}),
      'quorum 5 should score higher than quorum 1'
    );
  });

  it('exponential decay model reduces score over time', () => {
    const now = new Date();
    const old = new Date(now.getTime() - 100 * 24 * 3600 * 1000); // 100 days ago
    const a = makeAssertion({ staleness_model: 'exponential', created_at: old.toISOString() });
    const scoreOld = computeScore(a, new Set(), now, {});
    const scoreNew = computeScore(makeAssertion({ staleness_model: 'exponential' }), new Set(), now, {});
    assert.ok(scoreOld < scoreNew, 'old exponential assertion should score lower');
  });
});

describe('rank — rankAssertions', () => {
  it('returns assertions sorted by score descending', () => {
    const assertions = [
      makeAssertion({ id: 'a_low', confidence: 0.3, status: 'tentative', quorum_count: 1 }),
      makeAssertion({ id: 'a_high', confidence: 0.9, status: 'established', quorum_count: 5 }),
      makeAssertion({ id: 'a_mid', confidence: 0.6, status: 'tentative', quorum_count: 2 }),
    ];
    const ranked = rankAssertions(assertions);
    assert.equal(ranked[0].id, 'a_high');
    assert.equal(ranked[ranked.length - 1].id, 'a_low');
  });

  it('annotates in_tension correctly', () => {
    const assertions = [
      makeAssertion({ id: 'a_1' }),
      makeAssertion({ id: 'a_2' }),
    ];
    const ranked = rankAssertions(assertions, { tensionIds: new Set(['a_1']) });
    const r1 = ranked.find(a => a.id === 'a_1');
    const r2 = ranked.find(a => a.id === 'a_2');
    assert.equal(r1.in_tension, true);
    assert.equal(r2.in_tension, false);
  });
});

describe('rank — budgetCost', () => {
  it('terse: cost = claim.length', () => {
    const a = makeAssertion({ claim: 'short claim', density_hint: 'terse' });
    assert.equal(budgetCost(a), 'short claim'.length);
  });

  it('verbose with body: cost = body.length', () => {
    const a = makeAssertion({ claim: 'short', body: 'a much longer body text here', density_hint: 'verbose' });
    assert.equal(budgetCost(a), 'a much longer body text here'.length);
  });

  it('verbose without body: falls back to claim.length', () => {
    const a = makeAssertion({ claim: 'claim text', body: null, density_hint: 'verbose' });
    assert.equal(budgetCost(a), 'claim text'.length);
  });
});

describe('rank — selectForContext', () => {
  it('respects budget and excludes assertions that do not fit', () => {
    const assertions = [
      makeAssertion({ id: 'a_1', claim: 'x'.repeat(50), score: 0.9, in_tension: false }),
      makeAssertion({ id: 'a_2', claim: 'x'.repeat(50), score: 0.8, in_tension: false }),
      makeAssertion({ id: 'a_3', claim: 'x'.repeat(50), score: 0.7, in_tension: false }),
    ];
    const selected = rankSelectForContext(assertions, 110); // fits 2 of 3
    assert.equal(selected.length, 2);
    assert.ok(selected.some(a => a.id === 'a_1'));
    assert.ok(selected.some(a => a.id === 'a_2'));
    assert.ok(!selected.some(a => a.id === 'a_3'));
  });

  it('cache_stable assertions are selected before dynamic ones', () => {
    // stable is low score, dynamic is high score — stable should win the limited budget
    const assertions = [
      makeAssertion({ id: 'dyn_1',    claim: 'x'.repeat(60), score: 0.95, in_tension: false, cache_stable: 0 }),
      makeAssertion({ id: 'stable_1', claim: 'x'.repeat(60), score: 0.50, in_tension: false, cache_stable: 1 }),
    ];
    const selected = rankSelectForContext(assertions, 70); // only fits one
    assert.equal(selected.length, 1);
    assert.equal(selected[0].id, 'stable_1');
  });
});

// ---------------------------------------------------------------------------
// Ledger rankActive + selectForContext integration tests
// ---------------------------------------------------------------------------
describe('Ledger rankActive', () => {
  it('returns assertions ranked by score, tension assertions flagged', () => {
    const { ledger } = makeTestLedger();

    const idA = ledger.createAssertion({
      plane: 'project:R',
      class_: 'monotonic',
      claim: 'the sky is blue',
      confidence: 0.9,
      source_spans: ['s:1'],
    });
    // Reinforce so quorum_count = 2, then promote
    ledger.reinforceAssertion(idA, { source_span: 's:1b' });
    ledger.maybePromote(idA, 2);

    const idB = ledger.createAssertion({
      plane: 'project:R',
      class_: 'monotonic',
      claim: 'the sky is not blue',
      confidence: 0.5,
      source_spans: ['s:2'],
    });

    ledger.linkSupersession(idB, idA, 'contradicts');

    const ranked = ledger.rankActive('project:R');
    assert.equal(ranked.length, 2);
    // idA is established + high confidence but now in tension
    // idB is tentative + low confidence + in tension
    // Both are penalized; established idA should still rank first
    assert.equal(ranked[0].id, idA);
    assert.equal(ranked[0].in_tension, true);
    assert.equal(ranked[1].in_tension, true);
  });

  it('established without tension ranks above tentative with tension', () => {
    const { ledger } = makeTestLedger();

    const idClean = ledger.createAssertion({
      plane: 'project:R2',
      class_: 'monotonic',
      claim: 'grass is green',
      confidence: 0.8,
      source_spans: ['s:g1'],
    });
    ledger.reinforceAssertion(idClean, { source_span: 's:g2' });
    ledger.maybePromote(idClean, 2);

    const idTensed = ledger.createAssertion({
      plane: 'project:R2',
      class_: 'monotonic',
      claim: 'water is wet',
      confidence: 0.9,
      source_spans: ['s:w1'],
    });
    const idContra = ledger.createAssertion({
      plane: 'project:R2',
      class_: 'monotonic',
      claim: 'water is not wet',
      confidence: 0.5,
      source_spans: ['s:w2'],
    });
    ledger.linkSupersession(idContra, idTensed, 'contradicts');

    const ranked = ledger.rankActive('project:R2');
    // idClean: established, no tension
    // idTensed: tentative, in tension
    // idContra: tentative, in tension
    const cleanEntry = ranked.find(a => a.id === idClean);
    const tensedEntry = ranked.find(a => a.id === idTensed);
    assert.ok(cleanEntry.score > tensedEntry.score);
    assert.equal(cleanEntry.in_tension, false);
    assert.equal(tensedEntry.in_tension, true);
  });
});

describe('Ledger selectForContext', () => {
  it('returns only assertions that fit within budget', () => {
    const { ledger } = makeTestLedger();

    ledger.createAssertion({ plane: 'project:B', class_: 'monotonic', claim: 'x'.repeat(30), source_spans: ['s:1'] });
    ledger.createAssertion({ plane: 'project:B', class_: 'monotonic', claim: 'y'.repeat(30), source_spans: ['s:2'] });
    ledger.createAssertion({ plane: 'project:B', class_: 'monotonic', claim: 'z'.repeat(30), source_spans: ['s:3'] });

    const selected = ledger.selectForContext('project:B', 65);
    assert.equal(selected.length, 2);
    assert.ok(selected.every(a => a.plane === 'project:B'));
  });

  it('empty plane returns empty array', () => {
    const { ledger } = makeTestLedger();
    const selected = ledger.selectForContext('project:Empty', 10000);
    assert.deepEqual(selected, []);
  });

  it('cache_stable assertions are prioritized over higher-scoring dynamic ones', () => {
    const { ledger } = makeTestLedger();

    // high confidence but not stable
    ledger.createAssertion({
      plane: 'project:CS',
      class_: 'monotonic',
      claim: 'a'.repeat(50),
      confidence: 0.95,
      source_spans: ['s:d1'],
      cache_stable: 0,
      density_hint: 'terse',
    });
    // lower confidence but stable
    ledger.createAssertion({
      plane: 'project:CS',
      class_: 'monotonic',
      claim: 'b'.repeat(50),
      confidence: 0.4,
      source_spans: ['s:s1'],
      cache_stable: 1,
      density_hint: 'terse',
    });

    // budget fits exactly one (50 chars each)
    const selected = ledger.selectForContext('project:CS', 60);
    assert.equal(selected.length, 1);
    assert.equal(selected[0].cache_stable, 1);
  });
});
