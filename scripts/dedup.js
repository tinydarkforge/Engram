'use strict';

const NEGATION_WORDS = new Set([
  'not', "n't", 'no', 'never', 'neither', 'nor', 'without', 'none',
  'nobody', 'nothing', 'nowhere', 'isn', 'aren', 'wasn', 'weren',
  'hasn', 'haven', 'hadn', 'doesn', 'don', 'didn', 'won', 'wouldn',
  'shouldn', 'couldn', 'mustn', 'needn',
]);

function tokenize(text) {
  return new Set(
    text
      .toLowerCase()
      .replace(/[^\w\s]/g, '')
      .split(/\s+/)
      .filter(w => w.length > 0)
  );
}

function jaccardSimilarity(setA, setB) {
  if (setA.size === 0 && setB.size === 0) return 1.0;
  let intersectionSize = 0;
  for (const item of setA) {
    if (setB.has(item)) intersectionSize++;
  }
  const unionSize = setA.size + setB.size - intersectionSize;
  return unionSize === 0 ? 0 : intersectionSize / unionSize;
}

function removeNegations(tokens) {
  const result = new Set();
  for (const t of tokens) {
    if (!NEGATION_WORDS.has(t)) result.add(t);
  }
  return result;
}

function hasNegation(tokens) {
  for (const t of tokens) {
    if (NEGATION_WORDS.has(t)) return true;
  }
  return false;
}

function detectNegation(claimA, claimB, threshold = 0.7) {
  const tokA = tokenize(claimA);
  const tokB = tokenize(claimB);

  const negA = hasNegation(tokA);
  const negB = hasNegation(tokB);

  // Both negate or neither negates — no negation relationship
  if (negA === negB) return false;

  const coreA = removeNegations(tokA);
  const coreB = removeNegations(tokB);
  return jaccardSimilarity(coreA, coreB) >= threshold;
}

function findNearDuplicate(claims, newClaim, threshold = 0.7) {
  const newTokens = tokenize(newClaim);
  for (const { id, claim } of claims) {
    const sim = jaccardSimilarity(tokenize(claim), newTokens);
    if (sim >= threshold && !detectNegation(claim, newClaim, threshold)) {
      return { id, similarity: sim };
    }
  }
  return null;
}

function findNegations(claims, newClaim, threshold = 0.7) {
  const ids = [];
  for (const { id, claim } of claims) {
    if (detectNegation(claim, newClaim, threshold)) ids.push(id);
  }
  return ids;
}

module.exports = {
  tokenize,
  jaccardSimilarity,
  removeNegations,
  hasNegation,
  detectNegation,
  findNearDuplicate,
  findNegations,
};
