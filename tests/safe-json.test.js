#!/usr/bin/env node

const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { readJSON, validateIndex, validateSessionsIndex } = require('../scripts/safe-json');

describe('safe-json', () => {
  let tmpDir;

  before(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'engram-safe-json-'));
  });

  after(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  describe('readJSON()', () => {
    it('reads valid JSON file', () => {
      const filePath = path.join(tmpDir, 'valid.json');
      fs.writeFileSync(filePath, JSON.stringify({ key: 'value' }));
      const result = readJSON(filePath);
      assert.deepEqual(result, { key: 'value' });
    });

    it('returns fallback for missing file', () => {
      const result = readJSON(path.join(tmpDir, 'nonexistent.json'), { default: true });
      assert.deepEqual(result, { default: true });
    });

    it('returns null fallback by default for missing file', () => {
      const result = readJSON(path.join(tmpDir, 'nonexistent.json'));
      assert.equal(result, null);
    });

    it('returns fallback for corrupt JSON', () => {
      const filePath = path.join(tmpDir, 'corrupt.json');
      fs.writeFileSync(filePath, '{ not valid json !!!');
      const result = readJSON(filePath, []);
      assert.deepEqual(result, []);
    });

    it('returns fallback for empty file', () => {
      const filePath = path.join(tmpDir, 'empty.json');
      fs.writeFileSync(filePath, '');
      const result = readJSON(filePath, {});
      assert.deepEqual(result, {});
    });
  });

  describe('validateIndex()', () => {
    it('validates a correct index', () => {
      const data = {
        v: '4.0.0',
        u: '2025-12-01',
        m: { ts: 10 },
        g: { cs: {} },
        p: { TestProject: {} },
        t: { auth: {} },
      };
      const result = validateIndex(data);
      assert.equal(result.valid, true);
      assert.equal(result.errors.length, 0);
    });

    it('rejects null', () => {
      const result = validateIndex(null);
      assert.equal(result.valid, false);
      assert.ok(result.errors[0].includes('not an object'));
    });

    it('reports missing required fields', () => {
      const result = validateIndex({ v: '4.0.0' });
      assert.equal(result.valid, false);
      assert.ok(result.errors.length >= 4); // u, m, g, p, t missing
    });

    it('reports invalid m.ts type', () => {
      const result = validateIndex({
        v: '4.0.0', u: '2025-12-01', m: { ts: 'not a number' },
        g: {}, p: {}, t: {},
      });
      assert.equal(result.valid, false);
      assert.ok(result.errors.some(e => e.includes('m.ts')));
    });

    it('reports invalid p type', () => {
      const result = validateIndex({
        v: '4.0.0', u: '2025-12-01', m: { ts: 0 },
        g: {}, p: 'not an object', t: {},
      });
      assert.equal(result.valid, false);
      assert.ok(result.errors.some(e => e.includes('projects')));
    });
  });

  describe('validateSessionsIndex()', () => {
    it('validates a correct sessions index', () => {
      const data = {
        project: 'TestProject',
        total_sessions: 2,
        sessions: [{ id: 'a' }, { id: 'b' }],
      };
      const result = validateSessionsIndex(data);
      assert.equal(result.valid, true);
    });

    it('rejects null', () => {
      const result = validateSessionsIndex(null);
      assert.equal(result.valid, false);
    });

    it('reports missing sessions array', () => {
      const result = validateSessionsIndex({ project: 'X', total_sessions: 0 });
      assert.equal(result.valid, false);
      assert.ok(result.errors.some(e => e.includes('sessions')));
    });

    it('reports missing project field', () => {
      const result = validateSessionsIndex({ total_sessions: 0, sessions: [] });
      assert.equal(result.valid, false);
      assert.ok(result.errors.some(e => e.includes('project')));
    });

    it('reports invalid total_sessions type', () => {
      const result = validateSessionsIndex({ project: 'X', total_sessions: 'bad', sessions: [] });
      assert.equal(result.valid, false);
      assert.ok(result.errors.some(e => e.includes('total_sessions')));
    });
  });
});
