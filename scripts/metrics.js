/* eslint-disable */
const fs = require('fs');
const path = require('path');
const { resolveEngramPath } = require('./paths');

const ENGRAM_PATH = resolveEngramPath(__dirname);
const METRICS_PATH = path.join(ENGRAM_PATH, '.cache', 'metrics.json');
const LOCK_TTL_MS = 30 * 1000;

function atomicWriteFileSync(targetPath, content) {
  const dir = path.dirname(targetPath);
  fs.mkdirSync(dir, { recursive: true });
  const tmpPath = path.join(dir, `.tmp-${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}-${path.basename(targetPath)}`);
  const fd = fs.openSync(tmpPath, 'wx');
  try {
    fs.writeFileSync(fd, content);
    fs.fsyncSync(fd);
  } finally {
    fs.closeSync(fd);
  }
  fs.renameSync(tmpPath, targetPath);
}

function lockFilePath(targetPath) {
  return `${targetPath}.lock`;
}

async function withFileLock(targetPath, fn, { retries = 20, delayMs = 25 } = {}) {
  const dir = path.dirname(targetPath);
  fs.mkdirSync(dir, { recursive: true });
  const lockPath = lockFilePath(targetPath);
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const fd = fs.openSync(lockPath, 'wx');
      try {
        const payload = JSON.stringify({ pid: process.pid, started_at: Date.now() });
        fs.writeFileSync(fd, payload);
        fs.fsyncSync(fd);
        return await fn();
      } finally {
        fs.closeSync(fd);
        try {
          fs.unlinkSync(lockPath);
        } catch (e) {
          // Best effort cleanup
        }
      }
    } catch (e) {
      if (e.code !== 'EEXIST') throw e;
      try {
        const stat = fs.statSync(lockPath);
        const ageMs = Date.now() - stat.mtimeMs;
        if (ageMs > LOCK_TTL_MS) {
          fs.unlinkSync(lockPath);
          continue;
        }
      } catch (err) {
        if (err.code !== 'ENOENT') {
          // ignore and fall through to retry
        }
      }
      if (attempt === retries) throw new Error(`Lock timeout for ${path.basename(targetPath)}`);
      await new Promise(resolve => setTimeout(resolve, delayMs));
    }
  }
}

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

