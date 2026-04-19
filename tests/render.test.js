'use strict';
const { test } = require('node:test');
const assert = require('assert/strict');
const { renderAssertion, renderBlock } = require('../scripts/render');

// Fixture: mock assertion with all fields
function mkAssertion(overrides = {}) {
  return {
    id: 'a_test_001',
    plane: 'test:plane',
    class: 'monotonic',
    claim: 'test claim',
    body: 'test body',
    confidence: 0.75,
    status: 'established',
    created_at: new Date(Date.now() - 2 * 60 * 1000).toISOString(),
    last_verified: new Date(Date.now() - 5 * 60 * 1000).toISOString(),
    quorum_count: 3,
    density_hint: 'terse',
    in_tension: false,
    ...overrides,
  };
}

test('render: terse.monotonic → claim only', () => {
  const a = mkAssertion({ class: 'monotonic', density_hint: 'terse' });
  const out = renderAssertion(a);
  assert.strictEqual(out, 'test claim');
});

test('render: terse.episodic → claim only', () => {
  const a = mkAssertion({ class: 'episodic', density_hint: 'terse' });
  const out = renderAssertion(a);
  assert.strictEqual(out, 'test claim');
});

test('render: terse.state_bound → claim + verified age', () => {
  const a = mkAssertion({ class: 'state_bound', density_hint: 'terse' });
  const out = renderAssertion(a);
  assert.match(out, /test claim \[verified: \d+m ago\]/);
});

test('render: terse.contextual → claim + session-scoped', () => {
  const a = mkAssertion({ class: 'contextual', density_hint: 'terse' });
  const out = renderAssertion(a);
  assert.strictEqual(out, 'test claim [session-scoped]');
});

test('render: standard.monotonic → claim + confidence', () => {
  const a = mkAssertion({ class: 'monotonic', density_hint: 'standard' });
  const out = renderAssertion(a);
  assert.strictEqual(out, 'test claim (75%)');
});

test('render: standard.episodic → claim + confidence', () => {
  const a = mkAssertion({ class: 'episodic', density_hint: 'standard' });
  const out = renderAssertion(a);
  assert.strictEqual(out, 'test claim (75%)');
});

test('render: standard.state_bound → claim + confidence + verified', () => {
  const a = mkAssertion({ class: 'state_bound', density_hint: 'standard' });
  const out = renderAssertion(a);
  assert.match(out, /test claim \(75%, verified: \d+m ago\)/);
});

test('render: standard.contextual → claim + confidence + session-scoped', () => {
  const a = mkAssertion({ class: 'contextual', density_hint: 'standard' });
  const out = renderAssertion(a);
  assert.strictEqual(out, 'test claim (75%, session-scoped)');
});

test('render: verbose.monotonic → claim + body + metadata', () => {
  const a = mkAssertion({ class: 'monotonic', density_hint: 'verbose' });
  const out = renderAssertion(a);
  assert.match(out, /test claim\ntest body\n● established · confidence 75% · quorum 3/);
});

test('render: verbose.episodic → claim + body + created age', () => {
  const a = mkAssertion({ class: 'episodic', density_hint: 'verbose' });
  const out = renderAssertion(a);
  assert.match(out, /test claim\ntest body\n● established · confidence 75% · quorum 3 · created \d+m ago/);
});

test('render: verbose.state_bound → claim + body + verified age', () => {
  const a = mkAssertion({ class: 'state_bound', density_hint: 'verbose' });
  const out = renderAssertion(a);
  assert.match(out, /test claim\ntest body\n● established · verified \d+m ago · confidence 75% · quorum 3/);
});

test('render: verbose.contextual → claim + body + session-scoped', () => {
  const a = mkAssertion({ class: 'contextual', density_hint: 'verbose' });
  const out = renderAssertion(a);
  assert.match(out, /test claim\ntest body\n● established \[session-scoped\] · confidence 75% · quorum 3/);
});

test('render: in_tension → appends ⚠ tension', () => {
  const a = mkAssertion({ in_tension: true });
  const out = renderAssertion(a);
  assert.strictEqual(out, 'test claim ⚠ tension');
});

test('render: fallback for unknown class → terse.monotonic', () => {
  const a = mkAssertion({ class: 'unknown_class' });
  const out = renderAssertion(a);
  assert.strictEqual(out, 'test claim');
});

test('render: renderBlock → joins with newline', () => {
  const a1 = mkAssertion({ claim: 'claim 1' });
  const a2 = mkAssertion({ claim: 'claim 2' });
  const out = renderBlock([a1, a2]);
  assert.strictEqual(out, 'claim 1\nclaim 2');
});

test('render: renderBlock with header', () => {
  const a1 = mkAssertion({ claim: 'claim 1' });
  const out = renderBlock([a1], { header: 'Test Header' });
  assert.strictEqual(out, '## Test Header\nclaim 1');
});

test('render: renderBlock empty array → empty string', () => {
  const out = renderBlock([]);
  assert.strictEqual(out, '');
});

test('render: renderAssertion null → empty string', () => {
  const out = renderAssertion(null);
  assert.strictEqual(out, '');
});

test('render: verbose without body → no newline after claim', () => {
  const a = mkAssertion({ class: 'monotonic', density_hint: 'verbose', body: null });
  const out = renderAssertion(a);
  assert.match(out, /test claim\n● established · confidence 75% · quorum 3/);
  assert.ok(!out.match(/test claim\n\n/), 'should not have double newline');
});

test('render: status badge mapped correctly', () => {
  const badges = {
    tentative: '◯',
    established: '●',
    fossilized: '✕',
    quarantined: '⚠',
  };
  for (const [status, badge] of Object.entries(badges)) {
    const a = mkAssertion({ status, density_hint: 'verbose' });
    const out = renderAssertion(a);
    assert.ok(out.includes(badge), `status ${status} should include badge ${badge}`);
  }
});

test('render: confidence rounds to integer percent', () => {
  const a = mkAssertion({ confidence: 0.666, density_hint: 'standard' });
  const out = renderAssertion(a);
  assert.ok(out.includes('(67%)'), 'should round 66.6% to 67%');
});

test('render: never verified shows "never"', () => {
  const a = mkAssertion({ class: 'state_bound', density_hint: 'terse', last_verified: null });
  const out = renderAssertion(a);
  assert.ok(out.includes('[verified: never]'));
});
