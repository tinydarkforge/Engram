#!/usr/bin/env node
const path = require('path');
const os = require('os');
const { execFileSync } = require('child_process');

const { resolveEngramPath } = require('./paths');
const ENGRAM_PATH = process.env.ENGRAM_PATH || resolveEngramPath(__dirname);

const CHECK_INTERVAL_MS = (parseInt(process.env.ENGRAM_CONSOLIDATE_INTERVAL) || 300) * 1000;
const BATTERY_OK = process.env.ENGRAM_CONSOLIDATE_BATTERY_OK === 'true';
const MAX_LOAD = parseFloat(process.env.ENGRAM_CONSOLIDATE_MAX_LOAD) || 2.0;
const MIN_IDLE_MS = (parseInt(process.env.ENGRAM_CONSOLIDATE_MIN_IDLE) || 120) * 1000;

let lastRunTime = 0;

function log(msg) {
  console.log(`[consolidate] ${msg}`);
}

function isSystemIdle() {
  const [load1] = os.loadavg();
  const cpuCores = os.cpus().length;
  const normalized = load1 / cpuCores;
  if (normalized >= MAX_LOAD) {
    log(`Skipping — system load ${normalized.toFixed(2)} exceeds threshold ${MAX_LOAD}`);
    return false;
  }
  return true;
}

function isOnBattery() {
  try {
    if (process.platform === 'darwin') {
      const out = execFileSync('pmset', ['-g', 'batterystate'], { encoding: 'utf8', timeout: 2000 });
      if (out.includes('discharging')) return true;
    }
  } catch {
    /* not a Mac or pmset unavailable */
  }
  return false;
}

async function consolidate(tasks, options = {}) {
  const { onUpdate } = options;
  tasks = tasks || { bloom: true };

  if (tasks.bloom) {
    log('Rebuilding bloom filter...');
    try {
      const { buildEngramBloomFilter } = require('./bloom-filter');
      await buildEngramBloomFilter();
      log('Bloom filter rebuilt');
      if (onUpdate) onUpdate('engram://stats');
    } catch (e) {
      log('Bloom filter rebuild failed: ' + e.message);
    }
  }

  if (tasks.manifest) {
    log('Regenerating manifest...');
    try {
      execFileSync(process.execPath, [
        path.join(__dirname, 'manifest-manager.js'), 'generate',
      ], { cwd: ENGRAM_PATH, stdio: 'pipe' });
      log('Manifest regenerated');
      if (onUpdate) onUpdate('engram://stats');
    } catch (e) {
      log('Manifest regeneration failed: ' + e.message);
    }
  }

  if (tasks.ledger_scan) {
    log('Scanning ledger for contradictions...');
    try {
      const ledger = require('./ledger');
      const { scanPlane } = require('./contradiction-sentinel');
      const stats = ledger.stats();
      for (const plane of Object.keys(stats.by_plane)) {
        log(`  Scanning plane: ${plane}`);
        const result = await scanPlane(plane, { sampleSize: 50 });
        if (result.tensions_found > 0) {
          log(`    Found ${result.tensions_found} new tensions in ${plane}`);
          if (onUpdate) {
            onUpdate('engram://ledger/tensions');
            onUpdate(`engram://ledger/${encodeURIComponent(plane)}`);
          }
        }
      }
      log('Ledger scan complete');
    } catch (e) {
      log('Ledger scan failed: ' + e.message);
    }
  }

  if (tasks.ledger_verify) {
    log('Running verification hooks...');
    try {
      const ledger = require('./ledger');
      const hooks = require('./verification-hooks');
      const stats = ledger.stats();
      for (const plane of Object.keys(stats.by_plane)) {
        const assertions = ledger.queryActiveByPlane(plane, { classes: ['state_bound'] });
        if (assertions.length === 0) continue;
        const results = await hooks.runPending(assertions, {
          onVerified: (id) => ledger.markVerified(id),
        });
        const verified = results.filter((r) => r.status === 'verified').length;
        if (verified > 0) log(`  Verified ${verified} assertions in ${plane}`);
      }
      log('Verification hooks complete');
    } catch (e) {
      log('Verification hooks failed: ' + e.message);
    }
  }

  if (tasks.ledger_transform) {
    log('Transforming ledger assertions...');
    try {
      const ledger = require('./ledger');
      const { transformPlane } = require('./transform');
      const stats = ledger.stats();
      for (const plane of Object.keys(stats.by_plane)) {
        log(`  Transforming plane: ${plane}`);
        const result = await transformPlane(plane, { dryRun: false, yes: true });
        if (result.executed > 0) {
          log(`    Executed ${result.executed} transformations in ${plane}`);
          if (onUpdate) {
            onUpdate(`engram://ledger/${encodeURIComponent(plane)}`);
            onUpdate('engram://stats');
          }
        }
      }
      log('Ledger transformation complete');
    } catch (e) {
      log('Ledger transformation failed: ' + e.message);
    }
  }

  if (tasks.counterfactual) {
    log('Computing counterfactual weights...');
    try {
      const { computeWeights } = require('./counterfactual');
      const ledger = require('./ledger');
      const stats = ledger.stats();
      for (const plane of Object.keys(stats.by_plane)) {
        const result = computeWeights(plane);
        log(`  Computed ${result.computed} weights for ${plane}`);
      }
      if (onUpdate) onUpdate('engram://stats');
    } catch (e) {
      log('Counterfactual computation failed: ' + e.message);
    }
  }

  if (tasks.post_hoc) {
    log('Running post-hoc feedback scoring...');
    try {
      const ledger = require('./ledger');
      const db = ledger.getDb();
      const { scoreReply } = require('./capture');
      const sessions = db.prepare(
        `SELECT DISTINCT sl.session_id FROM selection_log sl
         LEFT JOIN assertion_outcomes ao ON ao.session_id = sl.session_id AND ao.signal_source = 'post_hoc'
         WHERE ao.id IS NULL
         LIMIT 20`
      ).all();
      if (sessions.length > 0) {
        for (const { session_id } of sessions) {
          try {
            const result = await scoreReply(session_id, '', { db, embedFn: null });
            if (result && result.scored > 0) {
              log(`  Scored ${result.scored} assertions for session ${session_id}`);
            }
          } catch (e) {
            log(`  Post-hoc scoring failed for ${session_id}: ${e.message}`);
          }
        }
      } else {
        log('  No pending sessions to score');
      }
      if (onUpdate) onUpdate('engram://stats');
    } catch (e) {
      log('Post-hoc feedback failed: ' + e.message);
    }
  }

  if (tasks.auto_resolve) {
    log('Auto-resolving stale tensions...');
    try {
      const ledger = require('./ledger');
      const db = ledger.getDb();
      const staleTensions = db.prepare(
        `SELECT tp.a_id, tp.b_id, tp.detected_at
         FROM tension_pairs tp
         WHERE tp.resolved_at IS NULL
           AND tp.detected_at < datetime('now', '-30 days')`
      ).all();
      if (staleTensions.length > 0) {
        const now = new Date().toISOString();
        const resolveStmt = db.prepare(
          `UPDATE tension_pairs SET resolved_at = ?, resolution = ? WHERE a_id = ? AND b_id = ? AND resolved_at IS NULL`
        );
        const tx = db.transaction((rows) => {
          for (const t of rows) {
            resolveStmt.run(now, 'auto_resolved_stale', t.a_id, t.b_id);
          }
        });
        tx(staleTensions);
        log(`  Auto-resolved ${staleTensions.length} stale tensions`);
        if (onUpdate) {
          onUpdate('engram://ledger/tensions');
          onUpdate('engram://stats');
        }
      } else {
        log('  No stale tensions to resolve');
      }
    } catch (e) {
      log('Auto-resolve failed: ' + e.message);
    }
  }

  if (tasks.embeddings) {
    log('Generating embeddings (this may take a while)...');
    if (isOnBattery() && !BATTERY_OK) {
      log('Skipping embeddings — on battery. Set ENGRAM_CONSOLIDATE_BATTERY_OK=true to override.');
      return;
    }
    try {
      execFileSync(process.execPath, [
        path.join(__dirname, 'vector-search.js'), 'generate',
      ], { cwd: ENGRAM_PATH, stdio: 'pipe' });
      log('Embeddings generated');
      if (onUpdate) onUpdate('engram://stats');
    } catch (e) {
      log('Embedding generation failed: ' + e.message);
    }
  }

  persistConsolidationStats({ tasks, onUpdate });
}

function persistConsolidationStats({ tasks } = {}) {
  try {
    const fs = require('fs');
    const statsPath = path.join(ENGRAM_PATH, '.cache', 'consolidation.json');
    const stats = { last_run_at: new Date().toISOString(), tasks_run: Object.keys(tasks || {}).filter(k => tasks[k]), };
    fs.mkdirSync(path.dirname(statsPath), { recursive: true });
    fs.writeFileSync(statsPath, JSON.stringify(stats));
  } catch (e) {
    log('Failed to persist consolidation stats: ' + e.message);
  }
}

function startWatcher(options = {}) {
  const { onUpdate } = options;
  log(`Auto-consolidation active (interval: ${CHECK_INTERVAL_MS / 1000}s, max_load: ${MAX_LOAD}, min_idle: ${MIN_IDLE_MS / 1000}s)`);
  const timer = setInterval(async () => {
    const now = Date.now();
    if (now - lastRunTime < MIN_IDLE_MS) return;
    if (!isSystemIdle()) return;
    if (isOnBattery() && !BATTERY_OK) {
      log('Skipping — on battery. Set ENGRAM_CONSOLIDATE_BATTERY_OK=true to override.');
      return;
    }
    lastRunTime = now;
    try {
      await consolidate({
        bloom: true,
        manifest: false,
        embeddings: false,
        ledger_scan: true,
        ledger_verify: true,
        ledger_transform: true,
        counterfactual: true,
        post_hoc: true,
        auto_resolve: true,
      }, { onUpdate });
    } catch (e) {
      log('Consolidation error: ' + e.message);
    }
  }, CHECK_INTERVAL_MS);

  if (typeof timer.unref === 'function') timer.unref();

  process.on('SIGINT', () => {
    clearInterval(timer);
    process.exit(0);
  });
  process.on('SIGTERM', () => {
    clearInterval(timer);
    process.exit(0);
  });
}

if (require.main === module) {
  const isWatcher = process.argv.includes('--watch');
  const tasks = {
    bloom: !process.argv.includes('--no-bloom'),
    manifest: process.argv.includes('--manifest'),
    embeddings: process.argv.includes('--embeddings'),
    ledger_scan: process.argv.includes('--scan') || process.argv.includes('--all'),
    ledger_verify: process.argv.includes('--verify') || process.argv.includes('--all'),
    ledger_transform: process.argv.includes('--transform') || process.argv.includes('--all'),
    counterfactual: process.argv.includes('--counterfactual') || process.argv.includes('--all'),
    post_hoc: process.argv.includes('--post-hoc') || process.argv.includes('--all'),
    auto_resolve: process.argv.includes('--auto-resolve') || process.argv.includes('--all'),
  };

  if (process.argv.includes('--all')) {
    tasks.bloom = true;
    tasks.manifest = true;
    tasks.embeddings = true;
    tasks.ledger_scan = true;
    tasks.ledger_transform = true;
    tasks.counterfactual = true;
    tasks.post_hoc = true;
    tasks.auto_resolve = true;
  }

  if (isWatcher) {
    consolidate(tasks)
      .then(() => startWatcher())
      .catch(e => { console.error(e.message); process.exit(1); });
  } else {
    consolidate(tasks).catch(e => { console.error(e.message); process.exit(1); });
  }
}

module.exports = { consolidate, startWatcher };
