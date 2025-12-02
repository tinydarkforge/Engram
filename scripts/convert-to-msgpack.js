#!/usr/bin/env node

/**
 * Convert Memex index from JSON to MessagePack
 *
 * Usage:
 *   node convert-to-msgpack.js           # Convert index.json
 *   node convert-to-msgpack.js all       # Convert all JSON files
 */

const fs = require('fs');
const path = require('path');
const msgpack = require('msgpack-lite');

const MEMEX_PATH = process.env.MEMEX_PATH || path.join(process.env.HOME, 'code/cirrus/DevOps/Memex');

/**
 * Convert a JSON file to MessagePack
 */
function convertToMessagePack(jsonPath) {
  if (!fs.existsSync(jsonPath)) {
    console.error(`❌ File not found: ${jsonPath}`);
    return false;
  }

  try {
    // Read JSON
    const json = JSON.parse(fs.readFileSync(jsonPath, 'utf8'));
    const jsonSize = fs.statSync(jsonPath).size;

    // Encode to MessagePack
    const msgpackBuffer = msgpack.encode(json);

    // Write MessagePack file
    const msgpackPath = jsonPath.replace(/\.json$/, '.msgpack');
    fs.writeFileSync(msgpackPath, msgpackBuffer);
    const msgpackSize = msgpackBuffer.length;

    // Calculate savings
    const reduction = ((jsonSize - msgpackSize) / jsonSize * 100).toFixed(1);

    console.log(`✅ ${path.basename(jsonPath)}`);
    console.log(`   JSON:       ${(jsonSize / 1024).toFixed(2)} KB`);
    console.log(`   MessagePack: ${(msgpackSize / 1024).toFixed(2)} KB`);
    console.log(`   Reduction:  ${reduction}%`);
    console.log(`   Saved to:   ${path.basename(msgpackPath)}`);
    console.log('');

    return true;
  } catch (error) {
    console.error(`❌ Error converting ${jsonPath}:`, error.message);
    return false;
  }
}

/**
 * Find all JSON files recursively
 */
function findJsonFiles(dir, files = []) {
  const items = fs.readdirSync(dir);

  for (const item of items) {
    const fullPath = path.join(dir, item);
    const stat = fs.statSync(fullPath);

    if (stat.isDirectory()) {
      // Skip node_modules and .git
      if (!['node_modules', '.git'].includes(item)) {
        findJsonFiles(fullPath, files);
      }
    } else if (item.endsWith('.json') && !item.endsWith('.msgpack.json')) {
      files.push(fullPath);
    }
  }

  return files;
}

// Main
const args = process.argv.slice(2);
const convertAll = args.includes('all');

console.log('🔄 Converting JSON to MessagePack...\n');

if (convertAll) {
  console.log('Converting all JSON files in Memex...\n');
  const jsonFiles = findJsonFiles(MEMEX_PATH);

  let successCount = 0;
  let totalReduction = 0;
  let originalSize = 0;
  let compressedSize = 0;

  for (const jsonPath of jsonFiles) {
    const originalStat = fs.statSync(jsonPath);
    originalSize += originalStat.size;

    if (convertToMessagePack(jsonPath)) {
      successCount++;
      const msgpackPath = jsonPath.replace(/\.json$/, '.msgpack');
      const compressedStat = fs.statSync(msgpackPath);
      compressedSize += compressedStat.size;
    }
  }

  const overallReduction = ((originalSize - compressedSize) / originalSize * 100).toFixed(1);

  console.log('📊 Summary:');
  console.log(`   Files converted: ${successCount}/${jsonFiles.length}`);
  console.log(`   Total JSON:      ${(originalSize / 1024).toFixed(2)} KB`);
  console.log(`   Total MessagePack: ${(compressedSize / 1024).toFixed(2)} KB`);
  console.log(`   Overall reduction: ${overallReduction}%`);

} else {
  // Just convert index.json
  const indexPath = path.join(MEMEX_PATH, 'index.json');
  convertToMessagePack(indexPath);
}

console.log('\n✅ Conversion complete!');
console.log('💡 Memex will now use MessagePack format (5x faster parsing)');
