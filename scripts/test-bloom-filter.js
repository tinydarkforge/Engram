#!/usr/bin/env node

/**
 * Bloom Filter Tests
 *
 * Tests the BloomFilter implementation for:
 * - Correct false positive rate
 * - Zero false negatives
 * - Performance characteristics
 * - Serialization/deserialization
 */

const BloomFilter = require('./bloom-filter');
const assert = require('assert');

// Test counter
let passed = 0;
let failed = 0;

function test(name, fn) {
  try {
    fn();
    console.log(`✓ ${name}`);
    passed++;
  } catch (error) {
    console.error(`✗ ${name}`);
    console.error(`  Error: ${error.message}`);
    failed++;
  }
}

console.log('🧪 Running Bloom Filter Tests...\n');

// Test 1: Basic functionality - add and check
test('Add items and check existence', () => {
  const filter = new BloomFilter(100, 0.01);

  filter.add('apple');
  filter.add('banana');
  filter.add('orange');

  assert.strictEqual(filter.mightContain('apple'), true, 'Should find apple');
  assert.strictEqual(filter.mightContain('banana'), true, 'Should find banana');
  assert.strictEqual(filter.mightContain('orange'), true, 'Should find orange');
});

// Test 2: Negative lookups (zero false negatives)
test('Negative lookups return false correctly', () => {
  const filter = new BloomFilter(100, 0.01);

  filter.add('existing');

  assert.strictEqual(filter.mightContain('nonexistent'), false, 'Should not find nonexistent item');
  assert.strictEqual(filter.mightContain('missing'), false, 'Should not find missing item');
  assert.strictEqual(filter.mightContain('absent'), false, 'Should not find absent item');
});

// Test 3: Case insensitivity
test('Case insensitive matching', () => {
  const filter = new BloomFilter(100, 0.01);

  filter.add('Docker');

  assert.strictEqual(filter.mightContain('docker'), true, 'Should match lowercase');
  assert.strictEqual(filter.mightContain('DOCKER'), true, 'Should match uppercase');
  assert.strictEqual(filter.mightContain('DoCkEr'), true, 'Should match mixed case');
});

// Test 4: False positive rate
test('False positive rate within expected bounds', () => {
  const filter = new BloomFilter(1000, 0.01); // 1% false positive rate

  // Add 1000 items
  for (let i = 0; i < 1000; i++) {
    filter.add(`item-${i}`);
  }

  // Test 10000 non-existent items
  let falsePositives = 0;
  for (let i = 1000; i < 11000; i++) {
    if (filter.mightContain(`item-${i}`)) {
      falsePositives++;
    }
  }

  const actualRate = falsePositives / 10000;

  // Allow 2x margin (0.01 -> 0.02) since it's probabilistic
  assert.ok(actualRate < 0.02, `False positive rate ${actualRate} should be < 0.02`);

  console.log(`  Actual false positive rate: ${(actualRate * 100).toFixed(3)}%`);
});

// Test 5: Serialization and deserialization
test('Serialization and deserialization', () => {
  const filter = new BloomFilter(100, 0.01);

  filter.add('test1');
  filter.add('test2');
  filter.add('test3');

  // Serialize
  const json = filter.toJSON();

  // Deserialize
  const restored = BloomFilter.fromJSON(json);

  // Verify restored filter works correctly
  assert.strictEqual(restored.mightContain('test1'), true, 'Restored filter should find test1');
  assert.strictEqual(restored.mightContain('test2'), true, 'Restored filter should find test2');
  assert.strictEqual(restored.mightContain('test3'), true, 'Restored filter should find test3');
  assert.strictEqual(restored.mightContain('test4'), false, 'Restored filter should not find test4');

  // Verify metadata
  assert.strictEqual(restored.itemCount, 3, 'Item count should be 3');
  assert.strictEqual(restored.expectedItems, 100, 'Expected items should match');
  assert.strictEqual(restored.falsePositiveRate, 0.01, 'False positive rate should match');
});

// Test 6: Empty filter
test('Empty filter returns false for all queries', () => {
  const filter = new BloomFilter(100, 0.01);

  assert.strictEqual(filter.mightContain('anything'), false, 'Empty filter should return false');
  assert.strictEqual(filter.mightContain('something'), false, 'Empty filter should return false');
  assert.strictEqual(filter.itemCount, 0, 'Item count should be 0');
});

// Test 7: Statistics
test('Statistics calculation', () => {
  const filter = new BloomFilter(100, 0.01);

  filter.add('item1');
  filter.add('item2');

  const stats = filter.getStats();

  assert.ok(stats.size_bytes > 0, 'Size in bytes should be > 0');
  assert.ok(stats.size_bits > 0, 'Size in bits should be > 0');
  assert.strictEqual(stats.items, 2, 'Items count should be 2');
  assert.ok(stats.hash_functions > 0, 'Hash functions should be > 0');
  assert.ok(stats.bits_set > 0, 'Some bits should be set');
  assert.ok(parseFloat(stats.fill_ratio) > 0, 'Fill ratio should be > 0');
  assert.ok(parseFloat(stats.actual_fpr) >= 0, 'Actual FPR should be >= 0');
});

// Test 8: Large dataset performance
test('Performance with large dataset', () => {
  const filter = new BloomFilter(10000, 0.01);

  const startAdd = Date.now();
  for (let i = 0; i < 10000; i++) {
    filter.add(`session-${i}`);
  }
  const addTime = Date.now() - startAdd;

  const startCheck = Date.now();
  for (let i = 0; i < 10000; i++) {
    filter.mightContain(`session-${i}`);
  }
  const checkTime = Date.now() - startCheck;

  console.log(`  Add 10k items: ${addTime}ms`);
  console.log(`  Check 10k items: ${checkTime}ms`);
  console.log(`  Avg check time: ${(checkTime / 10000).toFixed(3)}ms`);

  assert.ok(checkTime / 10000 < 1, 'Average check time should be < 1ms');
  assert.strictEqual(filter.itemCount, 10000, 'Item count should be 10000');
});

// Test 9: Size efficiency
test('Size efficiency', () => {
  const filter = new BloomFilter(1000, 0.01);

  for (let i = 0; i < 1000; i++) {
    filter.add(`item-${i}`);
  }

  const stats = filter.getStats();

  // Should be very small (< 2KB for 1000 items)
  assert.ok(stats.size_bytes < 2000, `Size ${stats.size_bytes} bytes should be < 2KB`);

  console.log(`  1000 items in ${stats.size_bytes} bytes (${(stats.size_bytes / 1000).toFixed(2)} bytes/item)`);
});

// Test 10: Memex-specific use case
test('Memex session topics search', () => {
  const filter = new BloomFilter(500, 0.01);

  // Add typical session topics
  const topics = [
    'auth', 'oauth', 'docker', 'api', 'database',
    'performance', 'security', 'testing', 'deployment',
    'frontend', 'backend', 'cicd', 'optimization'
  ];

  topics.forEach(topic => filter.add(topic));

  // Positive lookups
  assert.strictEqual(filter.mightContain('auth'), true, 'Should find auth');
  assert.strictEqual(filter.mightContain('docker'), true, 'Should find docker');
  assert.strictEqual(filter.mightContain('security'), true, 'Should find security');

  // Negative lookups (instant "no")
  assert.strictEqual(filter.mightContain('kubernetes'), false, 'Should not find kubernetes');
  assert.strictEqual(filter.mightContain('graphql'), false, 'Should not find graphql');
  assert.strictEqual(filter.mightContain('python'), false, 'Should not find python');

  console.log(`  ${topics.length} topics in ${filter.getStats().size_bytes} bytes`);
});

// Test 11: Save and load from disk
test('Save and load from disk', () => {
  const filter = new BloomFilter(100, 0.01);

  filter.add('save-test-1');
  filter.add('save-test-2');

  // This will save to .cache/bloom-filter.json
  // We won't actually test file I/O here to keep tests isolated
  // Just verify toJSON/fromJSON works

  const json = filter.toJSON();
  const loaded = BloomFilter.fromJSON(json);

  assert.strictEqual(loaded.mightContain('save-test-1'), true);
  assert.strictEqual(loaded.mightContain('save-test-2'), true);
  assert.strictEqual(loaded.mightContain('save-test-3'), false);
});

// Test 12: Hash function consistency
test('Hash functions produce consistent results', () => {
  const filter1 = new BloomFilter(100, 0.01);
  const filter2 = new BloomFilter(100, 0.01);

  filter1.add('consistent');
  filter2.add('consistent');

  // Both filters should have identical bit patterns
  assert.deepStrictEqual(
    Array.from(filter1.bits),
    Array.from(filter2.bits),
    'Bit patterns should be identical for same input'
  );
});

// Print results
console.log('\n' + '='.repeat(50));
console.log(`✅ Passed: ${passed}`);
if (failed > 0) {
  console.log(`❌ Failed: ${failed}`);
  process.exit(1);
} else {
  console.log('🎉 All tests passed!');
  process.exit(0);
}
