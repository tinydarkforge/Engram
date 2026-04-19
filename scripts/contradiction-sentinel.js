'use strict';
// Contradiction Sentinel — samples assertion pairs and seeds tension_pairs for contradictions
// Exports: scanPlane(plane, { sampleSize, threshold }) => { tensions_found }
// CLI: node scripts/contradiction-sentinel.js --plane <plane> [--sample-size <n>]

const { detectNegation } = require('./dedup');

function createSentinel(getLedgerFn) {
  async function scanPlane(plane, { sampleSize = 50, threshold = 0.7 } = {}) {
    const ledger = getLedgerFn();
    const rows = ledger.queryActiveByPlane(plane, { limit: sampleSize * 2 });

    // Shuffle if over sampleSize
    let sample = rows;
    if (rows.length > sampleSize) {
      // Fisher-Yates shuffle on a copy
      sample = rows.slice();
      for (let i = sample.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [sample[i], sample[j]] = [sample[j], sample[i]];
      }
      sample = sample.slice(0, sampleSize);
    }

    let tensions_found = 0;

    for (let i = 0; i < sample.length; i++) {
      for (let j = i + 1; j < sample.length; j++) {
        const a = sample[i];
        const b = sample[j];
        if (detectNegation(a.claim, b.claim, threshold)) {
          ledger.linkSupersession(a.id, b.id, 'contradicts');
          tensions_found += 1;
        }
      }
    }

    return { tensions_found };
  }

  return { scanPlane };
}

// Production singleton backed by real ledger
let _sentinel = null;
function getSentinel() {
  if (!_sentinel) {
    const ledger = require('./ledger');
    _sentinel = createSentinel(() => ledger);
  }
  return _sentinel;
}

function scanPlane(plane, opts) {
  return getSentinel().scanPlane(plane, opts);
}

module.exports = {
  scanPlane,
  _createForTesting: (ledger) => createSentinel(() => ledger),
};

if (require.main === module) {
  const args = process.argv.slice(2);
  let plane = null;
  let sampleSize = 50;
  let threshold = 0.7;

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--plane' && args[i + 1]) {
      plane = args[++i];
    } else if (args[i] === '--sample-size' && args[i + 1]) {
      sampleSize = parseInt(args[++i], 10);
    } else if (args[i] === '--threshold' && args[i + 1]) {
      threshold = parseFloat(args[++i]);
    }
  }

  if (!plane) {
    console.error('Usage: node contradiction-sentinel.js --plane <plane> [--sample-size <n>] [--threshold <f>]');
    process.exit(1);
  }

  scanPlane(plane, { sampleSize, threshold })
    .then(result => console.log(JSON.stringify(result, null, 2)))
    .catch(err => {
      console.error(err.message);
      process.exit(1);
    });
}
