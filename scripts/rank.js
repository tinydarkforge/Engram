'use strict';
// Ranking + budget enforcement for assertion selection.
// Pure functions — no DB access; all state is passed in.

const decayModels = require('./decay-models');

const STATUS_WEIGHT = { established: 1.0, tentative: 0.75 };

// Score an assertion. Lower confidence for assertions with open tensions.
function computeScore(assertion, tensionIds, now, context) {
  const model = decayModels[assertion.staleness_model] || decayModels.flat;
  const effectiveConf = model(assertion, now, context);
  const statusW = STATUS_WEIGHT[assertion.status] ?? 0.5;
  // quorumFactor: 1 corroboration → 0.2 weight, 5+ → full 1.0
  const quorumFactor = Math.min(assertion.quorum_count / 5, 1.0);
  const tensionPenalty = tensionIds.has(assertion.id) ? 0.5 : 1.0;
  return effectiveConf * statusW * (0.5 + 0.5 * quorumFactor) * tensionPenalty;
}

// Return assertions sorted by score descending, each annotated with score + in_tension.
function rankAssertions(assertions, { tensionIds = new Set(), now = new Date(), context = {} } = {}) {
  return assertions
    .map(a => ({
      ...a,
      score: computeScore(a, tensionIds, now, context),
      in_tension: tensionIds.has(a.id),
    }))
    .sort((a, b) => b.score - a.score);
}

// Character cost of including an assertion in a context window.
function budgetCost(assertion) {
  if (assertion.density_hint === 'verbose' && assertion.body) {
    return assertion.body.length;
  }
  return (assertion.claim || '').length;
}

// Greedy budget packing: cache_stable assertions get priority over dynamic ones.
// Both groups are in score order. Returns the subset that fits within budget.
function selectForContext(rankedAssertions, budget) {
  const stable = rankedAssertions.filter(a => a.cache_stable);
  const dynamic = rankedAssertions.filter(a => !a.cache_stable);

  const result = [];
  let remaining = budget;

  for (const a of [...stable, ...dynamic]) {
    const cost = budgetCost(a);
    if (cost <= remaining) {
      result.push(a);
      remaining -= cost;
    }
  }
  return result;
}

module.exports = { computeScore, rankAssertions, budgetCost, selectForContext };
