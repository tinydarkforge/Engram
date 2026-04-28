/* eslint-disable */
const fs = require('fs');
const path = require('path');
const { resolveEngramPath } = require('./paths');
const { atomicWriteFileSync, withFileLock } = require('./file-lock');

const ENGRAM_PATH = resolveEngramPath(__dirname);
const METRICS_PATH = path.join(ENGRAM_PATH, '.cache', 'metrics.json');

function defaultMetrics() {
  return {
    remember_calls_total: 0,
    remember_failures_total: 0,
    neural_search_calls_total: 0,
    sessions_total: 0,
    last_remember_at: null,
    last_search_at: null
  };
}

function readMetricsSync() {
  try {
    if (!fs.existsSync(METRICS_PATH)) return defaultMetrics();
    const data = JSON.parse(fs.readFileSync(METRICS_PATH, 'utf8'));
    return { ...defaultMetrics(), ...data };
  } catch {
    return defaultMetrics();
  }
}

async function updateMetrics(updater) {
  await withFileLock(METRICS_PATH, async () => {
    const current = readMetricsSync();
    const next = updater({ ...current }) || current;
    atomicWriteFileSync(METRICS_PATH, JSON.stringify(next, null, 2));
  });
}

module.exports = {
  METRICS_PATH,
  readMetricsSync,
  updateMetrics
};

