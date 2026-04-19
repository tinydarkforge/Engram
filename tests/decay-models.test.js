#!/usr/bin/env node

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const decayModels = require('../scripts/decay-models');

// Helper: build a minimal assertion object
function mkAssertion(overrides = {}) {
  const base = {
    confidence: 0.8,
    status: 'established',
    plane: 'project:Memex',
    created_at: new Date().toISOString(),
    last_reinforced: null,
    last_verified: null,
  };
  return { ...base, ...overrides };
}

// Helper: date N days ago as ISO string
function daysAgo(n) {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d.toISOString();
}

describe('Decay Models', () => {
  describe('flat', () => {
    it('returns confidence unchanged at t=0', () => {
      assert.equal(decayModels.flat(mkAssertion({ confidence: 0.8 })), 0.8);
    });
    it('returns confidence unchanged at t=365d', () => {
      const a = mkAssertion({ confidence: 0.6, created_at: daysAgo(365) });
      assert.equal(decayModels.flat(a), 0.6);
    });
  });

  describe('exponential', () => {
    it('returns full confidence at t=0', () => {
      const a = mkAssertion({ confidence: 0.8, last_reinforced: new Date().toISOString() });
      const result = decayModels.exponential(a);
      assert.ok(result >= 0.79, `expected ~0.8, got ${result}`);
    });

    it('decays after 7 days (should be less than full confidence)', () => {
      const a = mkAssertion({ confidence: 0.8, last_reinforced: daysAgo(7) });
      const result = decayModels.exponential(a);
      assert.ok(result < 0.8, `should be less than 0.8, got ${result}`);
      assert.ok(result > 0.6, `should be > 0.6 after 7 days, got ${result}`);
    });

    it('floors at 0.1 after 365 days', () => {
      const a = mkAssertion({ confidence: 0.8, created_at: daysAgo(400), last_reinforced: null });
      const result = decayModels.exponential(a);
      assert.ok(result <= 0.1, `should be <= 0.1 after 400 days, got ${result}`);
    });

    it('uses created_at when last_reinforced is null', () => {
      const a = mkAssertion({ confidence: 0.8, created_at: daysAgo(7), last_reinforced: null });
      const result = decayModels.exponential(a);
      assert.ok(result < 0.8);
    });
  });

  describe('state_bound', () => {
    it('returns 0 when status is fossilized', () => {
      const a = mkAssertion({ confidence: 0.9, status: 'fossilized' });
      assert.equal(decayModels.state_bound(a), 0);
    });

    it('halves confidence when last_verified is null', () => {
      const a = mkAssertion({ confidence: 0.8, last_verified: null });
      assert.equal(decayModels.state_bound(a), 0.4);
    });

    it('halves confidence when last_verified is older than 14 days', () => {
      const a = mkAssertion({ confidence: 0.8, last_verified: daysAgo(15) });
      assert.equal(decayModels.state_bound(a), 0.4);
    });

    it('returns full confidence when last_verified is recent', () => {
      const a = mkAssertion({ confidence: 0.8, last_verified: daysAgo(3) });
      assert.equal(decayModels.state_bound(a), 0.8);
    });
  });

  describe('episodic', () => {
    it('returns flat confidence when plane was active recently', () => {
      const a = mkAssertion({ confidence: 0.7, plane: 'project:Memex' });
      const context = { planeActivity: { 'project:Memex': daysAgo(5) } };
      assert.equal(decayModels.episodic(a, new Date(), context), 0.7);
    });

    it('applies exponential decay when plane has been idle > 30 days', () => {
      const a = mkAssertion({ confidence: 0.7, plane: 'project:Memex' });
      const context = { planeActivity: { 'project:Memex': daysAgo(40) } };
      const result = decayModels.episodic(a, new Date(), context);
      assert.ok(result < 0.7, `should decay after idle, got ${result}`);
    });

    it('returns flat confidence when no plane activity data provided', () => {
      const a = mkAssertion({ confidence: 0.7, plane: 'project:Memex' });
      assert.equal(decayModels.episodic(a), 0.7);
    });
  });

  describe('contextual', () => {
    it('returns 0 when session is not active', () => {
      const a = mkAssertion({ confidence: 0.9 });
      assert.equal(decayModels.contextual(a, new Date(), { session_active: false }), 0);
    });

    it('returns full confidence when session is active', () => {
      const a = mkAssertion({ confidence: 0.9 });
      assert.equal(decayModels.contextual(a, new Date(), { session_active: true }), 0.9);
    });

    it('defaults to active (returns confidence) when context not provided', () => {
      const a = mkAssertion({ confidence: 0.9 });
      assert.equal(decayModels.contextual(a), 0.9);
    });
  });
});
