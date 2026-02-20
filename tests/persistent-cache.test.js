#!/usr/bin/env node

const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const os = require('os');

describe('PersistentCache', () => {
  let tmpDir;
  let PersistentCache;

  before(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'memex-cache-test-'));

    // Set MEMEX_PATH so cache writes to our tmp dir
    process.env.MEMEX_PATH = tmpDir;

    // Ensure .cache subdir exists
    fs.mkdirSync(path.join(tmpDir, '.cache'), { recursive: true });

    // Clear module cache
    Object.keys(require.cache)
      .filter(k => k.includes('persistent-cache') || k.includes('paths'))
      .forEach(k => delete require.cache[k]);

    PersistentCache = require('../scripts/persistent-cache');
  });

  after(() => {
    delete process.env.MEMEX_PATH;
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('creates a cache instance with defaults', () => {
    const cache = new PersistentCache({ version: 'test' });
    assert.ok(cache);
    assert.equal(cache.version, 'test');
    assert.equal(cache.hits, 0);
    assert.equal(cache.misses, 0);
    cache.close();
  });

  it('set() and get() round-trip values', () => {
    const cache = new PersistentCache({ version: 'test' });
    cache.set('key1', { foo: 'bar' });
    const result = cache.get('key1');
    assert.deepEqual(result, { foo: 'bar' });
    cache.close();
  });

  it('get() returns null for missing keys', () => {
    const cache = new PersistentCache({ version: 'test' });
    const result = cache.get('nonexistent');
    assert.equal(result, null);
    assert.equal(cache.misses, 1);
    cache.close();
  });

  it('get() returns null for expired entries', () => {
    const cache = new PersistentCache({ version: 'test', ttl: 1 }); // 1ms TTL
    cache.set('expiring', 'value');

    // Wait for expiration
    const start = Date.now();
    while (Date.now() - start < 5) {} // busy wait 5ms

    const result = cache.get('expiring');
    assert.equal(result, null);
    assert.equal(cache.misses, 1);
    cache.close();
  });

  it('get() returns null for version mismatch', () => {
    const cache1 = new PersistentCache({ version: 'v1' });
    cache1.set('versioned', 'data');
    cache1.close();

    const cache2 = new PersistentCache({ version: 'v2' });
    const result = cache2.get('versioned');
    assert.equal(result, null);
    assert.equal(cache2.misses, 1);
    cache2.close();
  });

  it('tracks hits and misses', () => {
    const cache = new PersistentCache({ version: 'test' });
    cache.set('exists', 'yes');

    cache.get('exists');      // hit
    cache.get('exists');      // hit
    cache.get('missing1');    // miss
    cache.get('missing2');    // miss
    cache.get('missing3');    // miss

    assert.equal(cache.hits, 2);
    assert.equal(cache.misses, 3);
    cache.close();
  });

  it('delete() removes entries', () => {
    const cache = new PersistentCache({ version: 'test' });
    cache.set('deleteme', 'value');
    assert.deepEqual(cache.get('deleteme'), 'value');
    cache.delete('deleteme');
    assert.equal(cache.get('deleteme'), null);
    cache.close();
  });

  it('clear() removes all entries', () => {
    const cache = new PersistentCache({ version: 'test' });
    cache.set('a', 1);
    cache.set('b', 2);
    cache.clear();
    assert.equal(cache.get('a'), null);
    assert.equal(cache.get('b'), null);
    cache.close();
  });

  it('getStats() returns correct shape', () => {
    const cache = new PersistentCache({ version: 'test' });
    cache.set('stat-test', 'value');
    cache.get('stat-test'); // hit
    cache.get('missing');   // miss

    const stats = cache.getStats();
    assert.equal(typeof stats.total_entries, 'number');
    assert.equal(typeof stats.expired_entries, 'number');
    assert.equal(typeof stats.valid_entries, 'number');
    assert.equal(typeof stats.database_size_kb, 'number');
    assert.equal(stats.version, 'test');
    assert.equal(stats.lru_enabled, true);
    assert.equal(stats.hits, 1);
    assert.equal(stats.misses, 1);
    cache.close();
  });

  it('evicts LRU entries when maxEntries is reached', () => {
    const cache = new PersistentCache({ version: 'test', maxEntries: 3 });
    cache.set('first', 1);
    cache.set('second', 2);
    cache.set('third', 3);

    // Add fourth entry — should evict one of the existing entries
    cache.set('fourth', 4);

    // Fourth entry must be present
    assert.deepEqual(cache.get('fourth'), 4);

    // Count how many of the original 3 remain (should be 2)
    let remaining = 0;
    if (cache.get('first') !== null) remaining++;
    if (cache.get('second') !== null) remaining++;
    if (cache.get('third') !== null) remaining++;
    assert.equal(remaining, 2, 'Should have evicted exactly 1 entry');
    cache.close();
  });

  it('close() is safe to call multiple times', () => {
    const cache = new PersistentCache({ version: 'test' });
    cache.close();
    cache.close(); // should not throw
  });
});
