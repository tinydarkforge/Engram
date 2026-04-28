'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const Database = require('better-sqlite3');
const { runSqlMigrations } = require('../scripts/migrations');
const { _createForTesting: createLedger } = require('../scripts/ledger');
const { parseArgs, analyzeChanges, groupByAction } = require('../scripts/transform');

// ─────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────

function makeTestLedger() {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  runSqlMigrations(db);
  return createLedger(db);
}

function makeAssertion(ledger, overrides = {}) {
  return ledger.createAssertion({
    plane: overrides.plane ?? 'project:test',
    class_: overrides.class_ ?? 'monotonic',
    claim: overrides.claim ?? 'Test assertion',
    confidence: overrides.confidence ?? 0.8,
    staleness_model: overrides.staleness_model ?? 'flat',
    source_spans: overrides.source_spans ?? ['session:001'],
  });
}

// ─────────────────────────────────────────────────────────────
// parseArgs tests
// ─────────────────────────────────────────────────────────────

describe('transform: parseArgs defaults', () => {
  it('returns defaults with no args', () => {
    const args = parseArgs([]);
    assert.equal(args.plane, 'project:Engram');
    assert.equal(args.action, 'all');
    assert.equal(args.dryRun, true);
    assert.equal(args.confidenceThreshold, 0.7);
    assert.equal(args.yes, false);
  });
});

describe('transform: parseArgs --plane', () => {
  it('parses custom plane', () => {
    const args = parseArgs(['node', 'script.js', '--plane', 'user:daniel']);
    assert.equal(args.plane, 'user:daniel');
  });
});

describe('transform: parseArgs --action', () => {
  it('parses action', () => {
    const args = parseArgs(['node', 'script.js', '--action', 'promote']);
    assert.equal(args.action, 'promote');
  });
});

describe('transform: parseArgs --no-dry-run', () => {
  it('sets dryRun to false with --no-dry-run', () => {
    const args = parseArgs(['node', 'script.js', '--no-dry-run']);
    assert.equal(args.dryRun, false);
  });
});

describe('transform: parseArgs --execute', () => {
  it('sets dryRun to false with --execute', () => {
    const args = parseArgs(['node', 'script.js', '--execute']);
    assert.equal(args.dryRun, false);
  });
});

describe('transform: parseArgs --yes', () => {
  it('sets yes to true', () => {
    const args = parseArgs(['node', 'script.js', '--yes']);
    assert.equal(args.yes, true);
  });
});

// ─────────────────────────────────────────────────────────────
// analyzeChanges tests
// ─────────────────────────────────────────────────────────────

describe('transform: analyzeChanges returns empty for no candidates', () => {
  it('returns [] when no assertions match criteria', () => {
    const ledger = makeTestLedger();
    const id = makeAssertion(ledger, { status: 'established', confidence: 0.9 });
    const assertions = ledger.queryActiveByPlane('project:test');

    const changes = analyzeChanges(assertions, { action: 'promote' });
    assert.equal(changes.length, 0);
  });
});

describe('transform: analyzeChanges promotes tentative with quorum', () => {
  it('promotes tentative with quorum >= 2 and confidence >= 0.7', () => {
    const ledger = makeTestLedger();
    const id = makeAssertion(ledger, { confidence: 0.85 });
    ledger.reinforceAssertion(id, { source_span: 'session:002' });
    ledger.reinforceAssertion(id, { source_span: 'session:003' });

    const assertions = ledger.queryActiveByPlane('project:test');
    const changes = analyzeChanges(assertions, { action: 'promote' });

    assert.equal(changes.length, 1);
    assert.equal(changes[0].action, 'promote');
    assert.equal(changes[0].from_status, 'tentative');
    assert.equal(changes[0].to_status, 'established');
  });
});

describe('transform: analyzeChanges respects confidence threshold', () => {
  it('does not promote tentative with low confidence', () => {
    const ledger = makeTestLedger();
    const id = makeAssertion(ledger, { confidence: 0.5 });
    ledger.reinforceAssertion(id, { source_span: 'session:002' });

    const assertions = ledger.queryActiveByPlane('project:test');
    const changes = analyzeChanges(assertions, { action: 'promote', confidenceThreshold: 0.7 });

    assert.equal(changes.length, 0);
  });
});

describe('transform: analyzeChanges verifies stale state_bound', () => {
  it('marks state_bound assertions as needing verification', () => {
    const ledger = makeTestLedger();
    const staleDate = new Date(Date.now() - 25 * 24 * 60 * 60 * 1000).toISOString();
    const id = makeAssertion(ledger, {
      staleness_model: 'state_bound',
      created_at: staleDate,
    });

    const assertions = ledger.queryActiveByPlane('project:test').map(a => ({
      ...a,
      created_at: staleDate,
    }));

    const changes = analyzeChanges(assertions, { action: 'verify', staleDays: 14 });

    assert.ok(changes.length > 0);
    assert.equal(changes[0].action, 'verify');
  });
});

describe('transform: analyzeChanges fossilizes old unverified', () => {
  it('marks old established unverified assertions as fossilize candidates', () => {
    const ledger = makeTestLedger();
    const oldDate = new Date(Date.now() - 100 * 24 * 60 * 60 * 1000).toISOString();
    const id = makeAssertion(ledger);

    const assertions = ledger.queryActiveByPlane('project:test').map(a => ({
      ...a,
      created_at: oldDate,
      status: 'established',
    }));

    const changes = analyzeChanges(assertions, { action: 'fossilize', maxAgeDays: 90 });

    assert.ok(changes.length > 0);
    assert.equal(changes[0].action, 'fossilize');
  });
});

describe('transform: analyzeChanges weights low confidence', () => {
  it('marks low-confidence assertions for weighting', () => {
    const ledger = makeTestLedger();
    const id = makeAssertion(ledger, { confidence: 0.3 });

    const assertions = ledger.queryActiveByPlane('project:test');
    const changes = analyzeChanges(assertions, { action: 'weight' });

    assert.ok(changes.length > 0);
    assert.equal(changes[0].action, 'weight');
    assert.equal(changes[0].value, 0.5);
  });
});

// ─────────────────────────────────────────────────────────────
// groupByAction tests
// ─────────────────────────────────────────────────────────────

describe('transform: groupByAction groups correctly', () => {
  it('groups changes by action type', () => {
    const changes = [
      { action: 'promote', id: 'a_1' },
      { action: 'verify', id: 'a_2' },
      { action: 'promote', id: 'a_3' },
      { action: 'weight', id: 'a_4' },
    ];

    const grouped = groupByAction(changes);

    assert.equal(grouped.promote.length, 2);
    assert.equal(grouped.verify.length, 1);
    assert.equal(grouped.weight.length, 1);
    assert.equal(grouped.fossilize.length, 0);
  });
});

// ─────────────────────────────────────────────────────────────
// Integration: action=all
// ─────────────────────────────────────────────────────────────

describe('transform: analyzeChanges action=all combines all types', () => {
  it('detects promote + verify + fossilize + weight when action=all', () => {
    const ledger = makeTestLedger();

    // Promotable
    const promoteId = makeAssertion(ledger, { claim: 'promote me', confidence: 0.85 });
    ledger.reinforceAssertion(promoteId, { source_span: 'session:002' });

    // Verifiable (state_bound, stale)
    const verifyId = makeAssertion(ledger, {
      claim: 'verify me',
      staleness_model: 'state_bound',
    });

    // Weightable (low confidence)
    const weightId = makeAssertion(ledger, { claim: 'weight me', confidence: 0.2 });

    const assertions = ledger.queryActiveByPlane('project:test').map((a, i) => {
      if (i === 1) {
        return { ...a, created_at: new Date(Date.now() - 25 * 24 * 60 * 60 * 1000).toISOString() };
      }
      return a;
    });

    const changes = analyzeChanges(assertions, { action: 'all' });

    const grouped = groupByAction(changes);
    assert.ok(grouped.promote.length > 0, 'should have promote changes');
    assert.ok(grouped.verify.length > 0, 'should have verify changes');
    assert.ok(grouped.weight.length > 0, 'should have weight changes');
  });
});
