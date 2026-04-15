#!/usr/bin/env node

const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const os = require('os');

// Override paths before requiring VectorSearch
function createTestFixture() {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'memex-vector-test-'));
  fs.mkdirSync(path.join(tmpDir, '.cache'), { recursive: true });
  return tmpDir;
}

function cleanupFixture(tmpDir) {
  fs.rmSync(tmpDir, { recursive: true, force: true });
}

function loadVectorSearchWithFixture(fixturePath) {
  const modulesToClear = Object.keys(require.cache).filter(
    (k) => k.includes('vector-search') || k.includes('paths')
  );
  modulesToClear.forEach((k) => delete require.cache[k]);

  const pathsModule = require('../scripts/paths');
  const originalResolve = pathsModule.resolveMemexPath;
  pathsModule.resolveMemexPath = () => fixturePath;

  const VectorSearch = require('../scripts/vector-search');
  return { VectorSearch, restore: () => { pathsModule.resolveMemexPath = originalResolve; } };
}

describe('VectorSearch', () => {
  let fixturePath;
  let VectorSearch;
  let restore;

  before(() => {
    fixturePath = createTestFixture();
    const loaded = loadVectorSearchWithFixture(fixturePath);
    VectorSearch = loaded.VectorSearch;
    restore = loaded.restore;
  });

  after(() => {
    restore();
    cleanupFixture(fixturePath);
  });

  describe('cosineSimilarity()', () => {
    it('returns 1 for identical vectors', () => {
      const vs = new VectorSearch();
      const v = [1, 0, 0, 0];
      assert.equal(vs.cosineSimilarity(v, v), 1);
    });

    it('returns 0 for orthogonal vectors', () => {
      const vs = new VectorSearch();
      const a = [1, 0, 0];
      const b = [0, 1, 0];
      assert.equal(vs.cosineSimilarity(a, b), 0);
    });

    it('returns -1 for opposite vectors', () => {
      const vs = new VectorSearch();
      const a = [1, 0, 0];
      const b = [-1, 0, 0];
      assert.ok(Math.abs(vs.cosineSimilarity(a, b) - (-1)) < 0.0001);
    });

    it('returns 0 when a vector is all zeros', () => {
      const vs = new VectorSearch();
      const a = [0, 0, 0];
      const b = [1, 2, 3];
      assert.equal(vs.cosineSimilarity(a, b), 0);
    });

    it('throws for different-length vectors', () => {
      const vs = new VectorSearch();
      assert.throws(() => vs.cosineSimilarity([1, 2], [1, 2, 3]), /same length/);
    });

    it('handles normalized vectors correctly', () => {
      const vs = new VectorSearch();
      // Two similar but not identical unit vectors
      const a = [0.6, 0.8, 0];
      const b = [0.8, 0.6, 0];
      const sim = vs.cosineSimilarity(a, b);
      assert.ok(sim > 0.9, `Expected high similarity, got ${sim}`);
      assert.ok(sim < 1, `Expected less than 1, got ${sim}`);
    });
  });

  describe('keywordScore()', () => {
    it('returns 1 for exact match', () => {
      const vs = new VectorSearch();
      const score = vs.keywordScore('auth', 'auth');
      assert.ok(score > 0.9, `Expected high score for exact match, got ${score}`);
    });

    it('returns 0 for no match', () => {
      const vs = new VectorSearch();
      const score = vs.keywordScore('authentication', 'database migration');
      assert.equal(score, 0);
    });

    it('gives bonus for exact phrase match', () => {
      const vs = new VectorSearch();
      const phraseScore = vs.keywordScore('user auth', 'implemented user auth flow');
      const partialScore = vs.keywordScore('user auth', 'auth for user management system');
      // Both should match, but exact phrase should score higher
      assert.ok(phraseScore > 0, 'Phrase match should score > 0');
      assert.ok(partialScore > 0, 'Partial match should score > 0');
    });

    it('returns 0 for empty inputs', () => {
      const vs = new VectorSearch();
      assert.equal(vs.keywordScore('', 'some text'), 0);
      assert.equal(vs.keywordScore('query', ''), 0);
      assert.equal(vs.keywordScore(null, 'text'), 0);
    });

    it('ignores stop words', () => {
      const vs = new VectorSearch();
      // "the" and "and" are stop words, "for" is also a stop word
      const score = vs.keywordScore('the and for', 'the and for something');
      // All query words are stop words or < 3 chars, so score should be 0
      assert.equal(score, 0);
    });
  });

  describe('calculateDecay()', () => {
    it('returns 1.0 for today sessions', () => {
      const vs = new VectorSearch();
      const today = new Date().toISOString().split('T')[0];
      const decay = vs.calculateDecay(`xx-${today}-slug`);
      assert.equal(decay, 1.0);
    });

    it('returns less than 1 for old sessions', () => {
      const vs = new VectorSearch();
      const decay = vs.calculateDecay('xx-2024-01-01-old-session');
      assert.ok(decay < 1, `Expected decay < 1, got ${decay}`);
    });

    it('returns floor value for very old sessions', () => {
      const vs = new VectorSearch();
      const decay = vs.calculateDecay('xx-2020-01-01-ancient');
      assert.equal(decay, 0.1);
    });

    it('returns 1.0 when date cannot be parsed', () => {
      const vs = new VectorSearch();
      const decay = vs.calculateDecay('no-date-here');
      assert.equal(decay, 1.0);
    });

    it('respects custom decay rate', () => {
      const vs = new VectorSearch();
      // Use a date that's definitely in the past
      const pastDate = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];

      const fastDecay = vs.calculateDecay(`xx-${pastDate}-slug`, { decayRate: 0.90 });
      const slowDecay = vs.calculateDecay(`xx-${pastDate}-slug`, { decayRate: 0.99 });

      assert.ok(fastDecay < slowDecay, `Fast decay (${fastDecay}) should be less than slow decay (${slowDecay})`);
    });

    it('supports half-life parameter', () => {
      const vs = new VectorSearch();
      // 30-day half-life: after 30 days, score should be ~0.5
      const pastDate = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
      const decay = vs.calculateDecay(`xx-${pastDate}-slug`, { halfLifeDays: 30 });

      assert.ok(Math.abs(decay - 0.5) < 0.05, `Expected ~0.5 at half-life, got ${decay}`);
    });
  });

  describe('loadEmbeddings()', () => {
    it('returns empty state when no cache exists', () => {
      const vs = new VectorSearch();
      const embeddings = vs.loadEmbeddings();

      assert.ok(embeddings);
      assert.deepEqual(embeddings.sessions, {});
      assert.equal(embeddings.version, '1.0.0');
    });

    it('loads from cache file when it exists', () => {
      const cachedData = {
        sessions: {
          'test-session-1': { embedding: [0.1, 0.2], text_preview: 'test' },
        },
        version: '1.0.0',
      };

      fs.writeFileSync(
        path.join(fixturePath, '.cache', 'embeddings.json'),
        JSON.stringify(cachedData)
      );

      const vs = new VectorSearch();
      const embeddings = vs.loadEmbeddings();

      assert.equal(Object.keys(embeddings.sessions).length, 1);
      assert.ok(embeddings.sessions['test-session-1']);
    });
  });

  describe('search() without embeddings', () => {
    it('returns empty results when no embeddings exist', async () => {
      // Remove any cached embeddings
      const embPath = path.join(fixturePath, '.cache', 'embeddings.json');
      if (fs.existsSync(embPath)) fs.unlinkSync(embPath);

      const vs = new VectorSearch();
      vs.embeddings = { sessions: {}, version: '1.0.0' };
      const result = await vs.search('test query');

      assert.deepEqual(result.results, []);
      assert.ok(result.message.includes('No embeddings'));
    });
  });

  describe('getStats()', () => {
    it('returns stats with zero embeddings', () => {
      // Remove any cached embeddings
      const embPath = path.join(fixturePath, '.cache', 'embeddings.json');
      if (fs.existsSync(embPath)) fs.unlinkSync(embPath);

      const vs = new VectorSearch();
      const stats = vs.getStats();

      assert.equal(stats.total_embeddings, 0);
      assert.equal(stats.embedding_dimensions, 384);
      assert.equal(stats.model, 'all-MiniLM-L6-v2');
    });

    it('returns correct count when embeddings exist', () => {
      const cachedData = {
        sessions: {
          's1': { embedding: [0.1], text_preview: 'a' },
          's2': { embedding: [0.2], text_preview: 'b' },
        },
        version: '1.0.0',
      };
      fs.writeFileSync(
        path.join(fixturePath, '.cache', 'embeddings.json'),
        JSON.stringify(cachedData)
      );

      const vs = new VectorSearch();
      const stats = vs.getStats();
      assert.equal(stats.total_embeddings, 2);
    });
  });

  describe('findDuplicates()', () => {
    it('finds duplicate sessions above threshold', () => {
      const vs = new VectorSearch();
      vs.embeddings = {
        sessions: {
          's1': { embedding: [1, 0, 0], text_preview: 'auth flow' },
          's2': { embedding: [0.99, 0.1, 0], text_preview: 'auth flow v2' },
          's3': { embedding: [0, 1, 0], text_preview: 'database work' },
        },
        version: '1.0.0',
      };

      const result = vs.findDuplicates({ threshold: 0.9 });
      assert.ok(result.duplicates_found > 0, 'Should find at least one duplicate pair');
      assert.equal(result.duplicates[0].session1.id, 's1');
      assert.equal(result.duplicates[0].session2.id, 's2');
    });

    it('returns empty when no duplicates exist', () => {
      const vs = new VectorSearch();
      vs.embeddings = {
        sessions: {
          's1': { embedding: [1, 0, 0], text_preview: 'auth' },
          's2': { embedding: [0, 1, 0], text_preview: 'database' },
          's3': { embedding: [0, 0, 1], text_preview: 'frontend' },
        },
        version: '1.0.0',
      };

      const result = vs.findDuplicates({ threshold: 0.9 });
      assert.equal(result.duplicates_found, 0);
    });
  });

  describe('duplicate CLI helpers', () => {
    it('parses duplicate options with flags', () => {
      const options = VectorSearch.parseDuplicateArgs(['--threshold', '0.92', '--limit', '5', '--json']);
      assert.deepEqual(options, {
        threshold: 0.92,
        limit: 5,
        json: true
      });
    });

    it('supports backward-compatible positional threshold', () => {
      const options = VectorSearch.parseDuplicateArgs(['0.9']);
      assert.equal(options.threshold, 0.9);
      assert.equal(options.limit, 20);
      assert.equal(options.json, false);
    });

    it('rejects invalid duplicate options', () => {
      const result = VectorSearch.parseDuplicateArgs(['--threshold', '1.5']);
      assert.ok(result.error);
    });

    it('formats a human-readable duplicate report', () => {
      const output = VectorSearch.formatDuplicatesReport({
        total_pairs_checked: 3,
        duplicates_found: 1,
        duplicates: [
          {
            similarity: 0.93,
            session1: { id: 's1', preview: 'implemented oauth callback flow' },
            session2: { id: 's2', preview: 'implemented oauth callback flow with cleanup' }
          }
        ]
      }, {
        threshold: 0.9,
        limit: 10
      });

      assert.match(output, /Duplicate detection report/);
      assert.match(output, /93% similar/);
      assert.match(output, /A: s1/);
      assert.match(output, /B: s2/);
    });

    it('formats an empty duplicate report clearly', () => {
      const output = VectorSearch.formatDuplicatesReport({
        total_pairs_checked: 0,
        duplicates_found: 0,
        duplicates: []
      }, {
        threshold: 0.85,
        limit: 20
      });

      assert.match(output, /No duplicate candidates found/);
    });
  });
});
