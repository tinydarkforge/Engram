#!/usr/bin/env node

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const Database = require('better-sqlite3');
const path = require('path');
const { runSqlMigrations } = require('../scripts/migrations');

describe('SQL Migrations', () => {
  it('applies 0001_ledger.sql cleanly to a fresh in-memory DB', () => {
    const db = new Database(':memory:');
    const result = runSqlMigrations(db);
    assert.ok(Array.isArray(result.applied), 'applied should be an array');
    assert.ok(result.applied.includes('0001_ledger.sql'), 'should apply 0001_ledger.sql');
    // Verify tables exist
    const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map(r => r.name);
    assert.ok(tables.includes('assertions'), 'assertions table should exist');
    assert.ok(tables.includes('supersession_edges'), 'supersession_edges table should exist');
    assert.ok(tables.includes('tension_pairs'), 'tension_pairs table should exist');
    assert.ok(tables.includes('schema_migrations'), 'schema_migrations table should exist');
    db.close();
  });

  it('is idempotent — running twice does not error', () => {
    const db = new Database(':memory:');
    const r1 = runSqlMigrations(db);
    const r2 = runSqlMigrations(db);
    assert.equal(r2.applied.length, 0, 'second run should apply nothing');
    assert.ok(r2.skipped.includes('0001_ledger.sql'), 'second run should skip already-applied');
    db.close();
  });
});
