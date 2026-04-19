// Counterfactual Scorer — proxy for counterfactual weight: importance = f(quorum, connectivity, recency, rarity)
// NOTE: This is a proxy pending true counterfactual estimation via offline probe batches.
// Exports: computeWeights(plane, { window_days }) => void  (persists to ledger)
// CLI: node scripts/counterfactual.js --plane <plane>

module.exports = {};
