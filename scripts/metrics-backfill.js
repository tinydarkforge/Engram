#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const { glob } = require('glob');
const { resolveMemexPath } = require('./paths');
const { readJSON } = require('./safe-json');
const { METRICS_PATH } = require('./metrics');

const MEMEX_PATH = resolveMemexPath(__dirname);

async function scanSessions() {
  const sessionFiles = await glob('summaries/projects/*/sessions-index.json', {
    cwd: MEMEX_PATH
  });

  let totalSessions = 0;
  let lastSessionDate = null;

  for (const file of sessionFiles) {
    const fullPath = path.join(MEMEX_PATH, file);
    const index = readJSON(fullPath);
    if (!index || !Array.isArray(index.sessions)) continue;

    totalSessions += index.sessions.length;
    if (index.sessions.length > 0) {
      const latest = index.sessions[0];
      if (latest?.date && (!lastSessionDate || latest.date > lastSessionDate)) {
        lastSessionDate = latest.date;
      }
    }
  }

  return { totalSessions, lastSessionDate };
}

async function main() {
  const { totalSessions, lastSessionDate } = await scanSessions();
  const nowIso = new Date().toISOString();
  const metrics = {
    remember_calls_total: totalSessions,
    remember_failures_total: 0,
    neural_search_calls_total: 0,
    sessions_total: totalSessions,
    last_remember_at: lastSessionDate ? `${lastSessionDate}T00:00:00.000Z` : null,
    last_search_at: null,
    backfilled_at: nowIso
  };

  fs.mkdirSync(path.dirname(METRICS_PATH), { recursive: true });
  fs.writeFileSync(METRICS_PATH, JSON.stringify(metrics, null, 2));
  console.log(`Metrics backfilled: ${totalSessions} sessions`);
}

if (require.main === module) {
  main().catch((e) => {
    console.error(`Metrics backfill failed: ${e.message}`);
    process.exit(1);
  });
}

