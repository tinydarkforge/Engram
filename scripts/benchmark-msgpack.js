#!/usr/bin/env node

/**
 * Benchmark: JSON vs MessagePack
 * Tests parsing speed and file size comparison
 */

const fs = require('fs');
const path = require('path');
const msgpack = require('msgpack-lite');

const MEMEX_PATH = process.env.MEMEX_PATH || path.join(process.env.HOME, 'code/cirrus/DevOps/Memex');
const ITERATIONS = 100; // Number of iterations for timing

function benchmark() {
  console.log('🔬 Benchmarking JSON vs MessagePack\n');

  const jsonPath = path.join(MEMEX_PATH, 'index.json');
  const msgpackPath = path.join(MEMEX_PATH, 'index.msgpack');

  // Check files exist
  if (!fs.existsSync(jsonPath)) {
    console.error('❌ index.json not found');
    process.exit(1);
  }
  if (!fs.existsSync(msgpackPath)) {
    console.error('❌ index.msgpack not found');
    process.exit(1);
  }

  // File sizes
  const jsonSize = fs.statSync(jsonPath).size;
  const msgpackSize = fs.statSync(msgpackPath).size;
  const sizeReduction = ((jsonSize - msgpackSize) / jsonSize * 100).toFixed(1);

  console.log('📊 File Sizes:');
  console.log(`   JSON:       ${(jsonSize / 1024).toFixed(2)} KB`);
  console.log(`   MessagePack: ${(msgpackSize / 1024).toFixed(2)} KB`);
  console.log(`   Reduction:  ${sizeReduction}%\n`);

  // Read raw buffers (for consistent comparison)
  const jsonBuffer = fs.readFileSync(jsonPath);
  const msgpackBuffer = fs.readFileSync(msgpackPath);

  // Benchmark JSON parsing
  console.log(`⏱️  Parsing Performance (${ITERATIONS} iterations):\n`);

  const jsonStart = Date.now();
  for (let i = 0; i < ITERATIONS; i++) {
    JSON.parse(jsonBuffer.toString('utf8'));
  }
  const jsonTime = Date.now() - jsonStart;
  const jsonAvg = (jsonTime / ITERATIONS).toFixed(2);

  console.log(`   JSON:       ${jsonTime}ms total, ${jsonAvg}ms avg`);

  // Benchmark MessagePack parsing
  const msgpackStart = Date.now();
  for (let i = 0; i < ITERATIONS; i++) {
    msgpack.decode(msgpackBuffer);
  }
  const msgpackTime = Date.now() - msgpackStart;
  const msgpackAvg = (msgpackTime / ITERATIONS).toFixed(2);

  console.log(`   MessagePack: ${msgpackTime}ms total, ${msgpackAvg}ms avg`);

  // Calculate speedup
  const speedup = (jsonTime / msgpackTime).toFixed(1);
  const improvement = ((jsonTime - msgpackTime) / jsonTime * 100).toFixed(1);

  console.log(`\n✅ Results:`);
  console.log(`   Speedup:    ${speedup}x faster`);
  console.log(`   Improvement: ${improvement}% faster`);
  console.log(`   Size:       ${sizeReduction}% smaller\n`);

  // Verify data integrity
  const jsonData = JSON.parse(jsonBuffer.toString('utf8'));
  const msgpackData = msgpack.decode(msgpackBuffer);

  const jsonKeys = Object.keys(jsonData).sort();
  const msgpackKeys = Object.keys(msgpackData).sort();

  if (JSON.stringify(jsonKeys) === JSON.stringify(msgpackKeys)) {
    console.log('✅ Data integrity verified (same keys)\n');
  } else {
    console.log('⚠️  Warning: Key mismatch between formats\n');
  }
}

if (require.main === module) {
  benchmark();
}

module.exports = benchmark;
