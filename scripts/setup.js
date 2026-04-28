#!/usr/bin/env node

/**
 * Engram Setup
 *
 * Idempotent initializer that prepares directory structure and a minimal index.
 */

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const { resolveEngramPath } = require('./paths');
const { runMigrations } = require('./migrations');
const { readJSON } = require('./safe-json');

const ENGRAM_PATH = resolveEngramPath(__dirname);
const pkg = require('../package.json');

function hasIndexFiles(dir) {
  return (
    fs.existsSync(path.join(dir, 'index.json')) ||
    fs.existsSync(path.join(dir, 'index.json.gz')) ||
    fs.existsSync(path.join(dir, 'index.msgpack'))
  );
}

function ensureDir(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true });
}

function writeIndexIfMissing() {
  if (hasIndexFiles(ENGRAM_PATH)) {
    return false;
  }

  const nowIso = new Date().toISOString();
  const index = {
    v: pkg.version,
    u: nowIso,
    m: { ts: 0 },
    g: {
      cs: { s: 'Conventional Commits', qr: {} },
      pg: { s: 'PR Guidelines', qr: {} },
      bs: { s: 'Branching', qr: {} },
      cd: { s: 'Code Standards', qr: {} },
      sc: { s: 'Security', qr: {} }
    },
    p: {},
    t: {},
    _legend: {}
  };

  ensureDir(ENGRAM_PATH);
  fs.writeFileSync(path.join(ENGRAM_PATH, 'index.json'), JSON.stringify(index, null, 2));
  return true;
}

function runNodeScript(scriptPath, args = []) {
  execFileSync(process.execPath, [scriptPath, ...args], {
    cwd: ENGRAM_PATH,
    stdio: 'inherit'
  });
}

function main() {
  ensureDir(ENGRAM_PATH);
  ensureDir(path.join(ENGRAM_PATH, '.cache'));
  ensureDir(path.join(ENGRAM_PATH, '.neural'));
  ensureDir(path.join(ENGRAM_PATH, '.neural', 'bundles'));
  ensureDir(path.join(ENGRAM_PATH, 'summaries', 'projects'));
  ensureDir(path.join(ENGRAM_PATH, 'content', 'projects'));
  ensureDir(path.join(ENGRAM_PATH, 'metadata', 'projects'));

  const createdIndex = writeIndexIfMissing();
  runMigrations();

  // Ensure metadata files exist for known projects
  const index = readJSON(path.join(ENGRAM_PATH, 'index.json'));
  if (index && index.p) {
    for (const projectName of Object.keys(index.p)) {
      const metadataPath = path.join(ENGRAM_PATH, 'metadata', 'projects', `${projectName}.json`);
      if (!fs.existsSync(metadataPath)) {
        const minimal = { ts: [], d: '' };
        fs.writeFileSync(metadataPath, JSON.stringify(minimal, null, 2));
      }
    }
  }

  try {
    runNodeScript(path.join(__dirname, 'manifest-manager.js'), ['generate']);
  } catch (e) {
    console.warn(`Warning: manifest generation failed: ${e.message}`);
  }

  try {
    runNodeScript(path.join(__dirname, 'bloom-filter.js'), ['build']);
  } catch (e) {
    console.warn(`Warning: bloom filter build failed: ${e.message}`);
  }

  console.log(`Engram setup complete at ${ENGRAM_PATH}`);
  if (createdIndex) {
    console.log('Created new index.json');
  } else {
    console.log('Index already present');
  }
}

if (require.main === module) {
  try {
    main();
  } catch (e) {
    console.error(`Setup failed: ${e.message}`);
    process.exit(1);
  }
}

module.exports = { main };
