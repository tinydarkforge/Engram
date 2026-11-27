#!/usr/bin/env node

/**
 * Engram Setup
 *
 * Idempotent initializer that prepares directory structure and a minimal index.
 */

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const Database = require('better-sqlite3');
const { resolveEngramPath } = require('./paths');
const { runMigrations, runSqlMigrations } = require('./migrations');
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

function initializeLedger() {
  const db = new Database(path.join(ENGRAM_PATH, '.cache', 'engram.db'));
  try {
    db.pragma('journal_mode = WAL');
    db.pragma('busy_timeout = 5000');
    runSqlMigrations(db);
  } finally {
    db.close();
  }
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
  initializeLedger();

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

function writeAgentConfig(agentName) {
  const agents = {
    claude: { configPath: path.join(process.env.HOME || '/root', '.claude', 'mcp.json') },
    opencode: { configPath: process.env.OPENCODE_CONFIG_PATH || path.join(process.env.HOME || '/root', '.config', 'opencode', 'mcp.json') },
    aider: { configPath: path.join(process.env.HOME || '/root', '.aider', 'mcp.json') },
    cursor: { configPath: path.join(process.env.HOME || '/root', '.cursor', 'mcp.json') },
    windsurf: { configPath: path.join(process.env.HOME || '/root', '.windsurf', 'mcp.json') },
  };

  const agent = agents[agentName];
  if (!agent) {
    console.error(`Unknown agent: ${agentName}. Supported: ${Object.keys(agents).join(', ')}`);
    process.exit(1);
  }

  const mcpConfig = {
    mcpServers: {
      engram: {
        command: 'node',
        args: [path.resolve(__dirname, 'mcp-server.mjs')],
      },
    },
  };

  try {
    const dir = path.dirname(agent.configPath);
    ensureDir(dir);

    let existing = {};
    if (fs.existsSync(agent.configPath)) {
      existing = JSON.parse(fs.readFileSync(agent.configPath, 'utf8'));
    }

    existing.mcpServers = { ...existing.mcpServers, ...mcpConfig.mcpServers };
    fs.writeFileSync(agent.configPath, JSON.stringify(existing, null, 2));
    console.log(`Engram MCP configured for ${agentName} at ${agent.configPath}`);
  } catch (e) {
    console.error(`Failed to write config for ${agentName}: ${e.message}`);
    process.exit(1);
  }
}

if (require.main === module) {
  try {
    const agentIdx = process.argv.indexOf('--agent');
    if (agentIdx >= 0 && process.argv[agentIdx + 1]) {
      writeAgentConfig(process.argv[agentIdx + 1].toLowerCase());
    } else {
      main();
    }
  } catch (e) {
    console.error(`Setup failed: ${e.message}`);
    process.exit(1);
  }
}

module.exports = { main, writeAgentConfig };
