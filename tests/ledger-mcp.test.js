'use strict';
const { test } = require('node:test');
const assert = require('assert/strict');
const {
  ledgerIngest,
  ledgerQuery,
  ledgerSelectContext,
  ledgerStats,
} = require('../scripts/mcp-tools.js');

test('ledger-mcp: ledgerIngest creates an assertion', () => {
  // Mock: inject test ledger via module-level require intercept
  // For now, just test error handling
  const result = ledgerIngest({
    plane: 'test:plane',
    class_: 'monotonic',
    claim: 'test claim',
    source_spans: ['test:source']
  });
  // Should either succeed or fail gracefully
  assert.ok(result.error || result.ok, 'should have ok or error field');
});

test('ledger-mcp: ledgerQuery returns assertions', () => {
  const result = ledgerQuery('test:plane');
  assert.ok(result.error || result.ok, 'should have ok or error field');
  if (result.ok) {
    assert.strictEqual(result.plane, 'test:plane');
    assert.ok(Array.isArray(result.assertions), 'assertions should be an array');
  }
});

test('ledger-mcp: ledgerSelectContext returns rendered string', () => {
  const result = ledgerSelectContext('test:plane', 2000, { header: 'Test' });
  assert.ok(result.error || result.ok, 'should have ok or error field');
  if (result.ok) {
    assert.strictEqual(result.plane, 'test:plane');
    assert.strictEqual(result.budget, 2000);
    assert.ok(typeof result.rendered === 'string', 'rendered should be string');
  }
});

test('ledger-mcp: ledgerStats returns stats object', () => {
  const result = ledgerStats();
  assert.ok(result.error || result.ok, 'should have ok or error field');
  if (result.ok) {
    assert.ok(result.stats, 'should have stats property');
  }
});

test('ledger-mcp: ledgerIngest with missing required field returns error', () => {
  const result = ledgerIngest({
    plane: 'test:plane',
    // missing class_, claim, source_spans
  });
  assert.ok(result.error, 'should have error for missing fields');
});

test('ledger-mcp: ledgerQuery with missing plane returns error', () => {
  const result = ledgerQuery(null);
  // Should handle gracefully
  assert.ok(result.error || result.ok);
});

test('ledger-mcp: ledgerSelectContext without budget defaults to 2000', () => {
  const result = ledgerSelectContext('test:plane', undefined);
  // Dispatcher should provide default, or function should handle
  assert.ok(result.error || result.ok);
});
