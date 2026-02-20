#!/usr/bin/env node

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

// Clear module cache to get fresh BloomFilter
Object.keys(require.cache)
  .filter(k => k.includes('bloom-filter'))
  .forEach(k => delete require.cache[k]);

const BloomFilter = require('../scripts/bloom-filter');

describe('BloomFilter', () => {
  describe('constructor', () => {
    it('creates filter with correct defaults', () => {
      const filter = new BloomFilter(100, 0.01);
      assert.equal(filter.expectedItems, 100);
      assert.equal(filter.falsePositiveRate, 0.01);
      assert.ok(filter.size > 0);
      assert.ok(filter.numHashFunctions > 0);
      assert.equal(filter.itemCount, 0);
    });

    it('calculates optimal size for given parameters', () => {
      const small = new BloomFilter(10, 0.01);
      const large = new BloomFilter(10000, 0.01);
      assert.ok(large.size > small.size);
    });

    it('uses more hash functions for lower FPR', () => {
      const loose = new BloomFilter(1000, 0.1);
      const strict = new BloomFilter(1000, 0.001);
      assert.ok(strict.numHashFunctions >= loose.numHashFunctions);
    });
  });

  describe('add() and mightContain()', () => {
    it('returns true for added items', () => {
      const filter = new BloomFilter(100, 0.01);
      filter.add('hello');
      filter.add('world');
      assert.equal(filter.mightContain('hello'), true);
      assert.equal(filter.mightContain('world'), true);
    });

    it('returns false for items definitely not added', () => {
      const filter = new BloomFilter(100, 0.01);
      filter.add('hello');
      // With a well-sized filter and few items, this should be false
      assert.equal(filter.mightContain('xyzzy_not_in_filter_12345'), false);
    });

    it('increments itemCount on add', () => {
      const filter = new BloomFilter(100, 0.01);
      assert.equal(filter.itemCount, 0);
      filter.add('a');
      assert.equal(filter.itemCount, 1);
      filter.add('b');
      assert.equal(filter.itemCount, 2);
    });

    it('is case-insensitive (hashes lowercase)', () => {
      const filter = new BloomFilter(100, 0.01);
      filter.add('Docker');
      assert.equal(filter.mightContain('docker'), true);
      assert.equal(filter.mightContain('DOCKER'), true);
    });
  });

  describe('serialization', () => {
    it('toJSON() returns correct shape', () => {
      const filter = new BloomFilter(50, 0.01);
      filter.add('test');
      const json = filter.toJSON();

      assert.equal(json.version, '1.0.0');
      assert.equal(json.expectedItems, 50);
      assert.equal(json.falsePositiveRate, 0.01);
      assert.equal(json.itemCount, 1);
      assert.ok(Array.isArray(json.bits));
      assert.equal(typeof json.size, 'number');
      assert.equal(typeof json.numHashFunctions, 'number');
      assert.equal(typeof json.sizeBytes, 'number');
    });

    it('fromJSON() restores filter correctly', () => {
      const original = new BloomFilter(100, 0.01);
      original.add('alpha');
      original.add('beta');
      original.add('gamma');

      const json = original.toJSON();
      const restored = BloomFilter.fromJSON(json);

      assert.equal(restored.mightContain('alpha'), true);
      assert.equal(restored.mightContain('beta'), true);
      assert.equal(restored.mightContain('gamma'), true);
      assert.equal(restored.mightContain('nonexistent_xyz_999'), false);
      assert.equal(restored.itemCount, 3);
    });
  });

  describe('getStats()', () => {
    it('returns statistics', () => {
      const filter = new BloomFilter(100, 0.01);
      filter.add('test');
      const stats = filter.getStats();

      assert.equal(typeof stats.size_bytes, 'number');
      assert.equal(typeof stats.size_bits, 'number');
      assert.equal(stats.items, 1);
      assert.equal(typeof stats.hash_functions, 'number');
      assert.equal(typeof stats.bits_set, 'number');
      assert.ok(stats.bits_set > 0);
      assert.equal(typeof stats.fill_ratio, 'string');
      assert.equal(stats.target_fpr, 0.01);
    });
  });

  describe('getFalsePositiveRate()', () => {
    it('returns 0 for empty filter', () => {
      const filter = new BloomFilter(100, 0.01);
      assert.equal(filter.getFalsePositiveRate(), 0);
    });

    it('increases as items are added', () => {
      const filter = new BloomFilter(100, 0.01);
      filter.add('a');
      const rate1 = filter.getFalsePositiveRate();
      for (let i = 0; i < 50; i++) filter.add(`item-${i}`);
      const rate2 = filter.getFalsePositiveRate();
      assert.ok(rate2 > rate1);
    });
  });

  describe('countBitsSet()', () => {
    it('returns 0 for empty filter', () => {
      const filter = new BloomFilter(100, 0.01);
      assert.equal(filter.countBitsSet(), 0);
    });

    it('increases as items are added', () => {
      const filter = new BloomFilter(100, 0.01);
      filter.add('test');
      assert.ok(filter.countBitsSet() > 0);
    });
  });
});
