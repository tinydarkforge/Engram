'use strict';
// Transform — Batch assertion transformations with user confirmation gate
// Exports: transformPlane, and CLI entry point

const readline = require('readline');
const ledger = require('./ledger');
const { scanPlane } = require('./contradiction-sentinel');
const { runPending: runVerifications } = require('./verification-hooks');

const DEFAULT_PLANE = 'project:Memex';
const DEFAULT_CONFIDENCE_THRESHOLD = 0.7;
const DEFAULT_STALE_DAYS = 14;
const DEFAULT_MAX_AGE_DAYS = 90;
const DISPLAY_LIMIT = 15;

// ─────────────────────────────────────────────────────────────
// parseArgs
// ─────────────────────────────────────────────────────────────
function parseArgs(argv) {
  const args = {
    plane: DEFAULT_PLANE,
    action: 'all',
    dryRun: true,
    confidenceThreshold: DEFAULT_CONFIDENCE_THRESHOLD,
    staleDays: DEFAULT_STALE_DAYS,
    maxAgeDays: DEFAULT_MAX_AGE_DAYS,
    yes: false,
  };

  for (let i = 2; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--plane' && argv[i + 1]) {
      args.plane = argv[++i];
    } else if (arg === '--action' && argv[i + 1]) {
      args.action = argv[++i];
    } else if (arg === '--no-dry-run' || arg === '--execute') {
      args.dryRun = false;
    } else if (arg === '--confidence' && argv[i + 1]) {
      args.confidenceThreshold = parseFloat(argv[++i]);
    } else if (arg === '--stale-days' && argv[i + 1]) {
      args.staleDays = parseInt(argv[++i], 10);
    } else if (arg === '--yes') {
      args.yes = true;
    }
  }

  return args;
}

// ─────────────────────────────────────────────────────────────
// loadAssertions
// ─────────────────────────────────────────────────────────────
function loadAssertions(plane) {
  const assertions = ledger.queryActiveByPlane(plane, { limit: 1000 });
  return assertions;
}

// ─────────────────────────────────────────────────────────────
// ageInDays
// ─────────────────────────────────────────────────────────────
function ageInDays(isoTimestamp) {
  const created = new Date(isoTimestamp);
  const now = new Date();
  const ms = now.getTime() - created.getTime();
  return ms / (1000 * 60 * 60 * 24);
}

// ─────────────────────────────────────────────────────────────
// analyzeChanges
// ─────────────────────────────────────────────────────────────
function analyzeChanges(assertions, opts = {}) {
  const {
    action = 'all',
    confidenceThreshold = DEFAULT_CONFIDENCE_THRESHOLD,
    staleDays = DEFAULT_STALE_DAYS,
    maxAgeDays = DEFAULT_MAX_AGE_DAYS,
  } = opts;

  const ranked = assertions.map(a => ({
    ...a,
    age_days: ageInDays(a.created_at),
  }));

  const changes = [];

  for (const assertion of ranked) {
    // Promote: tentative with sufficient quorum and confidence
    if ((action === 'all' || action === 'promote') && assertion.status === 'tentative') {
      if (assertion.quorum_count >= 2 && assertion.confidence >= confidenceThreshold) {
        changes.push({
          id: assertion.id,
          action: 'promote',
          from_status: 'tentative',
          to_status: 'established',
          reason: `quorum_count=${assertion.quorum_count} >= 2, confidence=${assertion.confidence.toFixed(2)} >= ${confidenceThreshold}`,
          confidence: assertion.confidence,
          quorum: assertion.quorum_count,
        });
      }
    }

    // Verify: state_bound assertions that are stale
    if ((action === 'all' || action === 'verify') && assertion.staleness_model === 'state_bound') {
      if (assertion.age_days > staleDays && !assertion.last_verified) {
        changes.push({
          id: assertion.id,
          action: 'verify',
          from_status: assertion.status,
          reason: `state_bound unverified for ${assertion.age_days.toFixed(1)} days > ${staleDays}`,
          age_days: assertion.age_days,
        });
      }
    }

    // Fossilize: old, unverified, established assertions
    if ((action === 'all' || action === 'fossilize') && assertion.status === 'established') {
      if (assertion.age_days > maxAgeDays && !assertion.last_verified) {
        changes.push({
          id: assertion.id,
          action: 'fossilize',
          from_status: 'established',
          to_status: 'fossilized',
          reason: `unverified for ${assertion.age_days.toFixed(1)} days > ${maxAgeDays}`,
          age_days: assertion.age_days,
        });
      }
    }

    // Weight: low confidence or in tension
    if ((action === 'all' || action === 'weight') && assertion.confidence < 0.5) {
      changes.push({
        id: assertion.id,
        action: 'weight',
        value: 0.5,
        reason: `low confidence ${assertion.confidence.toFixed(2)}`,
        confidence: assertion.confidence,
      });
    }
  }

  return changes;
}

// ─────────────────────────────────────────────────────────────
// groupByAction
// ─────────────────────────────────────────────────────────────
function groupByAction(changes) {
  const grouped = {
    promote: [],
    verify: [],
    fossilize: [],
    weight: [],
  };
  for (const change of changes) {
    if (change.action in grouped) {
      grouped[change.action].push(change);
    }
  }
  return grouped;
}

// ─────────────────────────────────────────────────────────────
// displaySummary
// ─────────────────────────────────────────────────────────────
function displaySummary(changes) {
  const grouped = groupByAction(changes);
  const total = changes.length;

  console.log('\nProposed Changes:');
  console.log('─'.repeat(80));

  if (changes.length === 0) {
    console.log('  (no changes proposed)');
  } else {
    const display = changes.slice(0, DISPLAY_LIMIT);
    const symbols = { promote: '↑', verify: '✓', fossilize: '✕', weight: '⚖' };

    console.log(
      '┌─────┬──────────┬─────────────────────────────────────────┬──────────────┐'
    );
    console.log(
      '│ #   │ Action   │ Reason                                  │ ID (abbrev)  │'
    );
    console.log(
      '├─────┼──────────┼─────────────────────────────────────────┼──────────────┤'
    );

    for (let i = 0; i < display.length; i++) {
      const c = display[i];
      const reason = c.reason.substring(0, 39).padEnd(39);
      const idAbbrev = c.id.substring(0, 12);
      const sym = symbols[c.action] || '?';
      console.log(
        `│ ${(i + 1).toString().padEnd(3)} │ ${sym} ${c.action.padEnd(6)} │ ${reason} │ ${idAbbrev.padEnd(12)} │`
      );
    }

    console.log(
      '└─────┴──────────┴─────────────────────────────────────────┴──────────────┘'
    );

    if (total > DISPLAY_LIMIT) {
      console.log(`  ... and ${total - DISPLAY_LIMIT} more`);
    }
  }

  console.log('\nSummary:');
  console.log(`  Promote:   ${grouped.promote.length} tentative → established`);
  console.log(`  Verify:    ${grouped.verify.length} state_bound assertions`);
  console.log(`  Fossilize: ${grouped.fossilize.length} stale unverified assertions`);
  console.log(`  Weight:    ${grouped.weight.length} low-confidence assertions`);
  console.log(`  Total:     ${total} changes`);
}

// ─────────────────────────────────────────────────────────────
// askConfirmation
// ─────────────────────────────────────────────────────────────
function askConfirmation() {
  return new Promise((resolve) => {
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
    });

    rl.question('\nContinue? (yes/no): ', (answer) => {
      rl.close();
      resolve(answer.toLowerCase() === 'yes' || answer.toLowerCase() === 'y');
    });
  });
}

// ─────────────────────────────────────────────────────────────
// executeChanges
// ─────────────────────────────────────────────────────────────
function executeChanges(changes) {
  const results = {
    promoted: 0,
    verified: 0,
    fossilized: 0,
    weighted: 0,
    errors: [],
  };

  for (const change of changes) {
    try {
      if (change.action === 'promote') {
        ledger.maybePromote(change.id, 2);
        results.promoted++;
      } else if (change.action === 'verify') {
        ledger.markVerified(change.id);
        results.verified++;
      } else if (change.action === 'fossilize') {
        ledger.markFossilized(change.id, change.reason);
        results.fossilized++;
      } else if (change.action === 'weight') {
        ledger.setCounterfactualWeight(change.id, change.value);
        results.weighted++;
      }
    } catch (e) {
      results.errors.push({ id: change.id, error: e.message });
    }
  }

  return results;
}

// ─────────────────────────────────────────────────────────────
// reportResults
// ─────────────────────────────────────────────────────────────
function reportResults(results) {
  console.log('\nResults:');
  console.log(`  Promoted:   ${results.promoted}`);
  console.log(`  Verified:   ${results.verified}`);
  console.log(`  Fossilized: ${results.fossilized}`);
  console.log(`  Weighted:   ${results.weighted}`);

  if (results.errors.length > 0) {
    console.log(`  Errors:     ${results.errors.length}`);
    for (const err of results.errors) {
      console.error(`    ${err.id}: ${err.error}`);
    }
  }

  console.log(`\nTotal transformed: ${results.promoted + results.verified + results.fossilized + results.weighted}`);
}

// ─────────────────────────────────────────────────────────────
// transformPlane
// ─────────────────────────────────────────────────────────────
async function transformPlane(plane, opts = {}) {
  const {
    dryRun = true,
    action = 'all',
    confidenceThreshold = DEFAULT_CONFIDENCE_THRESHOLD,
    staleDays = DEFAULT_STALE_DAYS,
    maxAgeDays = DEFAULT_MAX_AGE_DAYS,
    yes = false,
  } = opts;

  console.log(`\nScanning ${plane} for transformation candidates...`);

  const assertions = loadAssertions(plane);
  console.log(`  Found ${assertions.length} active assertions`);

  const changes = analyzeChanges(assertions, {
    action,
    confidenceThreshold,
    staleDays,
    maxAgeDays,
  });

  displaySummary(changes);

  if (changes.length === 0) {
    console.log('\nNo changes proposed. Exiting.');
    return { changes: [], executed: 0, skipped: 0 };
  }

  if (dryRun) {
    console.log('\n[DRY-RUN MODE] — No changes applied');
    return { changes, executed: 0, skipped: changes.length };
  }

  let confirmed = yes;
  if (!yes) {
    confirmed = await askConfirmation();
  }

  if (!confirmed) {
    console.log('\nCancelled. No changes applied.');
    return { changes, executed: 0, skipped: changes.length };
  }

  console.log('\nExecuting changes...');
  const results = executeChanges(changes);
  reportResults(results);

  return { changes, executed: results.promoted + results.verified + results.fossilized + results.weighted, errors: results.errors };
}

// ─────────────────────────────────────────────────────────────
// CLI Entry Point
// ─────────────────────────────────────────────────────────────
if (require.main === module) {
  const args = parseArgs(process.argv);
  transformPlane(args.plane, {
    dryRun: args.dryRun,
    action: args.action,
    confidenceThreshold: args.confidenceThreshold,
    staleDays: args.staleDays,
    maxAgeDays: args.maxAgeDays,
    yes: args.yes,
  })
    .then((result) => {
      if (result.errors && result.errors.length > 0) {
        process.exit(1);
      }
    })
    .catch((err) => {
      console.error('Error:', err.message);
      process.exit(1);
    });
}

module.exports = { transformPlane, parseArgs, analyzeChanges, groupByAction };
