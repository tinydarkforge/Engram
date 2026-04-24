#!/usr/bin/env node

/**
 * Codicil Setup
 *
 * Idempotent initializer that prepares directory structure and a minimal index.
 */

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const { resolveCodicilPath } = require('./paths');
const { runMigrations } = require('./migrations');
const { readJSON } = require('./safe-json');

const CODICIL_PATH = resolveCodicilPath(__dirname);
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
  if (hasIndexFiles(CODICIL_PATH)) {
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

  ensureDir(CODICIL_PATH);
  fs.writeFileSync(path.join(CODICIL_PATH, 'index.json'), JSON.stringify(index, null, 2));
  return true;
}

function runNodeScript(scriptPath, args = []) {
  execFileSync(process.execPath, [scriptPath, ...args], {
    cwd: CODICIL_PATH,
    stdio: 'inherit'
  });
}

function main() {
  ensureDir(CODICIL_PATH);
  ensureDir(path.join(CODICIL_PATH, '.cache'));
  ensureDir(path.join(CODICIL_PATH, '.neural'));
  ensureDir(path.join(CODICIL_PATH, '.neural', 'bundles'));
  ensureDir(path.join(CODICIL_PATH, 'summaries', 'projects'));
  ensureDir(path.join(CODICIL_PATH, 'content', 'projects'));
  ensureDir(path.join(CODICIL_PATH, 'metadata', 'projects'));

  const createdIndex = writeIndexIfMissing();
  runMigrations();

  // Ensure metadata files exist for known projects
  const index = readJSON(path.join(CODICIL_PATH, 'index.json'));
  if (index && index.p) {
    for (const projectName of Object.keys(index.p)) {
      const metadataPath = path.join(CODICIL_PATH, 'metadata', 'projects', `${projectName}.json`);
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

  console.log(`Codicil setup complete at ${CODICIL_PATH}`);
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
