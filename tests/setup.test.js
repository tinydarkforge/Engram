'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { execFileSync } = require('child_process');
const Database = require('better-sqlite3');

test('setup initializes the SQLite ledger schema', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'engram-setup-'));
  try {
    execFileSync(process.execPath, [path.join(__dirname, '..', 'scripts', 'setup.js')], {
      env: { ...process.env, ENGRAM_PATH: dir },
      stdio: 'pipe'
    });

    const db = new Database(path.join(dir, '.cache', 'engram.db'));
    try {
      const tables = db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all().map(row => row.name);
      assert.ok(tables.includes('assertions'));
      assert.ok(tables.includes('schema_migrations'));
      const applied = db.prepare('SELECT version FROM schema_migrations ORDER BY version').all().map(row => row.version);
      assert.ok(applied.includes('0001_ledger.sql'));
    } finally {
      db.close();
    }
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
