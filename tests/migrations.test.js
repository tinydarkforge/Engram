#!/usr/bin/env node

const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const os = require('os');

describe('Migrations', () => {
  let tmpDir;
  let restoreResolve;
  let runMigrations;

  before(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'memex-migrate-'));
    const index = {
      v: '4.0.0',
      u: new Date().toISOString(),
      m: { ts: 0 },
      g: {},
      p: {},
      t: {}
    };
    fs.writeFileSync(path.join(tmpDir, 'index.json'), JSON.stringify(index, null, 2));

    const pathsModule = require('../scripts/paths');
    const originalResolve = pathsModule.resolveMemexPath;
    pathsModule.resolveMemexPath = () => tmpDir;
    restoreResolve = () => { pathsModule.resolveMemexPath = originalResolve; };

    delete require.cache[require.resolve('../scripts/migrations')];
    ({ runMigrations } = require('../scripts/migrations'));
  });

  after(() => {
    restoreResolve();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('adds schema_version when missing', () => {
    const result = runMigrations();
    assert.equal(result.ok, true);
    const updated = JSON.parse(fs.readFileSync(path.join(tmpDir, 'index.json'), 'utf8'));
    assert.equal(updated.schema_version, 1);
  });
});

