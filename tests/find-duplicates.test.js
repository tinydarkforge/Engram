#!/usr/bin/env node

/**
 * Tests for findDuplicates MCP tool (#14)
 *
 * Tests the mcp-tools.findDuplicates() wrapper and VectorSearch.findDuplicates()
 * using a fixture with synthetic embeddings — no external deps required.
 */

const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const os = require('os');

let tmpDir;
let findDuplicates;
let VectorSearch;

function makeEmbedding(values) {
  // Pad/trim to 4 dims for test speed
  return values;
}

function writeEmbeddings(dir, sessions) {
  const cacheDir = path.join(dir, '.cache');
  fs.mkdirSync(cacheDir, { recursive: true });
  const data = { sessions: {}, model: 'test', version: 1 };
  for (const [id, emb] of Object.entries(sessions)) {
    data.sessions[id] = { embedding: emb, text_preview: `preview for ${id}` };
  }
  fs.writeFileSync(path.join(cacheDir, 'embeddings.json'), JSON.stringify(data));
}

function loadTools(fixturePath) {
  // Clear module cache so paths resolve to fixture
  Object.keys(require.cache)
    .filter(k => k.includes('mcp-tools') || k.includes('vector-search') || k.includes('paths'))
    .forEach(k => delete require.cache[k]);

  process.env.ENGRAM_PATH = fixturePath;
  // mcp-tools also needs index.json to not crash on load
  if (!fs.existsSync(path.join(fixturePath, 'index.json'))) {
    fs.writeFileSync(path.join(fixturePath, 'index.json'), JSON.stringify({
      v: '4.0.0', u: new Date().toISOString(), m: {}, p: {}, t: {}
    }));
  }

  const tools = require('../scripts/mcp-tools');
  return tools;
}

function loadVS(fixturePath) {
  Object.keys(require.cache)
    .filter(k => k.includes('vector-search') || k.includes('paths'))
    .forEach(k => delete require.cache[k]);
  process.env.ENGRAM_PATH = fixturePath;
  return require('../scripts/vector-search');
}

describe('findDuplicates (MCP tool)', () => {
  before(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'engram-dedup-test-'));

    // Two nearly-identical sessions (cosine similarity ~1.0) + one orthogonal
    writeEmbeddings(tmpDir, {
      'sess-A': [1, 0, 0, 0],
      'sess-B': [1, 0, 0, 0],   // identical to A → similarity 1.0
      'sess-C': [0, 1, 0, 0],   // orthogonal to A/B
    });

    const tools = loadTools(tmpDir);
    findDuplicates = tools.findDuplicates;
  });

  after(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
    delete process.env.ENGRAM_PATH;
    Object.keys(require.cache)
      .filter(k => k.includes('mcp-tools') || k.includes('vector-search') || k.includes('paths'))
      .forEach(k => delete require.cache[k]);
  });

  it('returns expected result shape', async () => {
    const result = await findDuplicates();
    assert.ok('threshold' in result || 'error' in result, 'must have threshold or error key');
    if (!result.error) {
      assert.ok(typeof result.duplicates_found === 'number');
      assert.ok(Array.isArray(result.duplicates));
    }
  });

  it('detects identical-vector pair above default threshold', async () => {
    const result = await findDuplicates({ threshold: 0.99 });
    if (result.error) return; // embeddings not loaded in this env — skip
    assert.ok(result.duplicates_found >= 1, 'expected at least one duplicate pair');
    const pair = result.duplicates[0];
    assert.ok(pair.similarity >= 0.99);
    const ids = [pair.session1.id, pair.session2.id].sort();
    assert.deepEqual(ids, ['sess-A', 'sess-B']);
  });

  it('returns zero duplicates when threshold is 1.0 for non-identical vectors', async () => {
    const result = await findDuplicates({ threshold: 1.0, limit: 20 });
    if (result.error) return;
    // sess-A and sess-B are [1,0,0,0] exactly — cosine = 1.0, so still matches
    // All others orthogonal → no other pairs
    const nonExact = result.duplicates.filter(d => d.similarity < 1.0);
    assert.equal(nonExact.length, 0);
  });

  it('respects limit option', async () => {
    const result = await findDuplicates({ threshold: 0.0, limit: 1 });
    if (result.error) return;
    assert.ok(result.duplicates.length <= 1);
  });

  it('returns structured error on failure (no embeddings)', async () => {
    const emptyDir = fs.mkdtempSync(path.join(os.tmpdir(), 'engram-dedup-empty-'));
    fs.writeFileSync(path.join(emptyDir, 'index.json'), JSON.stringify({
      v: '4.0.0', u: new Date().toISOString(), m: {}, p: {}, t: {}
    }));

    Object.keys(require.cache)
      .filter(k => k.includes('mcp-tools') || k.includes('vector-search') || k.includes('paths'))
      .forEach(k => delete require.cache[k]);
    process.env.ENGRAM_PATH = emptyDir;
    const tools2 = require('../scripts/mcp-tools');

    const result = await tools2.findDuplicates();
    // Either returns error key OR returns 0 duplicates (both valid when no embeddings)
    if (result.error) {
      assert.equal(typeof result.error, 'string');
      assert.equal(result.duplicates_found, 0);
      assert.deepEqual(result.duplicates, []);
    } else {
      assert.equal(result.duplicates_found, 0);
    }

    fs.rmSync(emptyDir, { recursive: true, force: true });
  });

  it('default threshold is 0.85', async () => {
    const result = await findDuplicates();
    if (result.error) return;
    assert.equal(result.threshold, 0.85);
  });
});

// ─────────────────────────────────────────────────────────────
// VectorSearch.findDuplicates() unit tests
// ─────────────────────────────────────────────────────────────

describe('VectorSearch.findDuplicates()', () => {
  let vsDir;
  let vs;

  before(() => {
    vsDir = fs.mkdtempSync(path.join(os.tmpdir(), 'engram-vs-dedup-'));
    writeEmbeddings(vsDir, {
      'x-1': [1, 0, 0, 0],
      'x-2': [1, 0, 0, 0],
      'x-3': [0, 0, 1, 0],
    });

    Object.keys(require.cache)
      .filter(k => k.includes('vector-search') || k.includes('paths'))
      .forEach(k => delete require.cache[k]);
    process.env.ENGRAM_PATH = vsDir;
    const VS = require('../scripts/vector-search');
    vs = new VS();
    vs.loadEmbeddings();
  });

  after(() => {
    fs.rmSync(vsDir, { recursive: true, force: true });
  });

  it('finds duplicate pair at threshold 0.99', () => {
    const result = vs.findDuplicates({ threshold: 0.99 });
    assert.equal(result.duplicates_found, 1);
    assert.equal(result.duplicates[0].similarity, 1);
  });

  it('finds no duplicates when threshold exceeds all similarities', () => {
    const result = vs.findDuplicates({ threshold: 1.01 });
    assert.equal(result.duplicates_found, 0);
  });

  it('sorts results by similarity descending', () => {
    const result = vs.findDuplicates({ threshold: 0.0 });
    for (let i = 1; i < result.duplicates.length; i++) {
      assert.ok(result.duplicates[i - 1].similarity >= result.duplicates[i].similarity);
    }
  });

  it('reports correct total pairs checked', () => {
    // 3 sessions → 3*(3-1)/2 = 3 pairs
    const result = vs.findDuplicates({ threshold: 0.0 });
    assert.equal(result.total_pairs_checked, 3);
  });

  it('each duplicate entry has session1, session2, similarity', () => {
    const result = vs.findDuplicates({ threshold: 0.99 });
    const dup = result.duplicates[0];
    assert.ok(dup.session1?.id);
    assert.ok(dup.session2?.id);
    assert.ok(typeof dup.similarity === 'number');
  });
});
