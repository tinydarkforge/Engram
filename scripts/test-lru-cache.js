#!/usr/bin/env node

/**
 * Test LRU Cache Implementation
 * Verifies that the cache properly evicts least recently used entries
 */

const PersistentCache = require('./persistent-cache.js');

async function testLRU() {
  console.log('🧪 Testing LRU Cache Implementation\n');

  // Create cache with max 5 entries for easy testing
  const cache = new PersistentCache({
    maxEntries: 5,
    ttl: 60 * 60 * 1000, // 1 hour
    version: 'test-lru'
  });

  // Clear cache for clean test
  cache.clear();

  console.log('1️⃣ Adding 5 entries (max capacity)...');
  cache.set('key1', { data: 'value1' });
  cache.set('key2', { data: 'value2' });
  cache.set('key3', { data: 'value3' });
  cache.set('key4', { data: 'value4' });
  cache.set('key5', { data: 'value5' });

  let stats = cache.getStats();
  console.log(`   ✓ Cache has ${stats.total_entries} entries (${stats.capacity_used_percent}% capacity)`);
  console.log('');

  console.log('2️⃣ Accessing key1 and key2 (updating LRU order)...');
  cache.get('key1');
  cache.get('key2');
  console.log('   ✓ key1 and key2 are now most recently used');
  console.log('');

  console.log('3️⃣ Adding key6 (should evict key3 - least recently used)...');
  cache.set('key6', { data: 'value6' });

  const key3 = cache.get('key3');
  const key6 = cache.get('key6');

  console.log(`   key3 exists: ${key3 !== null} (expected: false)`);
  console.log(`   key6 exists: ${key6 !== null} (expected: true)`);

  if (key3 === null && key6 !== null) {
    console.log('   ✅ LRU eviction working correctly!');
  } else {
    console.log('   ❌ LRU eviction failed!');
  }
  console.log('');

  console.log('4️⃣ Accessing key1 again (make it most recent)...');
  cache.get('key1');
  console.log('   ✓ key1 is now the most recently accessed');
  console.log('');

  console.log('5️⃣ Cache statistics before batch test:');
  stats = cache.getStats();
  console.log(`   Total entries: ${stats.total_entries}/${stats.max_entries}`);
  console.log(`   Capacity used: ${stats.capacity_used_percent}%`);
  console.log(`   LRU enabled: ${stats.lru_enabled}`);
  console.log('');

  console.log('6️⃣ Testing batch eviction (add 3 more entries)...');
  cache.set('key7', { data: 'value7' });
  cache.set('key8', { data: 'value8' });
  cache.set('key9', { data: 'value9' });

  stats = cache.getStats();
  console.log(`   ✓ Cache maintained at ${stats.total_entries} entries (max: ${stats.max_entries})`);

  // Verify oldest entries were evicted
  const key4 = cache.get('key4');
  const key5 = cache.get('key5');
  const key1 = cache.get('key1'); // Should still exist (was accessed in step 2)

  console.log(`   key4 exists: ${key4 !== null} (expected: false)`);
  console.log(`   key5 exists: ${key5 !== null} (expected: false)`);
  console.log(`   key1 exists: ${key1 !== null} (expected: true)`);

  if (key4 === null && key5 === null && key1 !== null) {
    console.log('   ✅ Batch LRU eviction working correctly!');
  } else {
    console.log('   ❌ Batch LRU eviction failed!');
  }

  console.log('');
  console.log('✅ LRU Cache Test Complete!');

  cache.close();
}

testLRU().catch(console.error);
