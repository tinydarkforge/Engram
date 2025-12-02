#!/usr/bin/env node

/**
 * Compress Index - Create gzipped version of index.json
 * This reduces load time and network transfer by 60-70%
 */

const fs = require('fs').promises;
const fsSync = require('fs');
const path = require('path');
const zlib = require('zlib');
const { promisify } = require('util');

const gzip = promisify(zlib.gzip);

const MEMEX_PATH = process.env.MEMEX_PATH || path.join(process.env.HOME, 'code/cirrus/DevOps/Memex');

async function compressIndex() {
  const indexPath = path.join(MEMEX_PATH, 'index.json');
  const compressedPath = `${indexPath}.gz`;

  console.log('🗜️  Compressing index.json...');
  console.log('');

  try {
    // Read index.json
    const data = await fs.readFile(indexPath, 'utf8');
    const originalSize = Buffer.byteLength(data, 'utf8');

    // Compress
    const compressed = await gzip(data, {
      level: zlib.constants.Z_BEST_COMPRESSION
    });

    // Write compressed version
    await fs.writeFile(compressedPath, compressed);

    const compressedSize = compressed.length;
    const reduction = ((1 - compressedSize / originalSize) * 100).toFixed(1);

    console.log('✅ Compression complete!');
    console.log('');
    console.log(`Original size:    ${(originalSize / 1024).toFixed(2)} KB`);
    console.log(`Compressed size:  ${(compressedSize / 1024).toFixed(2)} KB`);
    console.log(`Reduction:        ${reduction}%`);
    console.log('');
    console.log(`Saved to: ${compressedPath}`);
    console.log('');
    console.log('💡 The v3 loader will automatically use the compressed version if available.');

  } catch (error) {
    console.error('❌ Compression failed:', error.message);
    process.exit(1);
  }
}

// Also compress other large JSON files
async function compressAll() {
  console.log('🗜️  Compressing all JSON files in Memex...');
  console.log('');

  const files = [
    'index.json',
    'metadata/projects/DemoProject.json',
    // Add more files as needed
  ];

  for (const file of files) {
    const filePath = path.join(MEMEX_PATH, file);
    if (!fsSync.existsSync(filePath)) {
      console.log(`⊘  Skipping ${file} (not found)`);
      continue;
    }

    try {
      const data = await fs.readFile(filePath, 'utf8');
      const originalSize = Buffer.byteLength(data, 'utf8');

      const compressed = await gzip(data, {
        level: zlib.constants.Z_BEST_COMPRESSION
      });

      await fs.writeFile(`${filePath}.gz`, compressed);

      const compressedSize = compressed.length;
      const reduction = ((1 - compressedSize / originalSize) * 100).toFixed(1);

      console.log(`✅ ${file}`);
      console.log(`   ${(originalSize / 1024).toFixed(2)} KB → ${(compressedSize / 1024).toFixed(2)} KB (${reduction}% reduction)`);
    } catch (error) {
      console.log(`❌ ${file}: ${error.message}`);
    }
  }

  console.log('');
  console.log('✅ Compression complete!');
}

// CLI
const command = process.argv[2];

if (command === 'all') {
  compressAll().catch(console.error);
} else {
  compressIndex().catch(console.error);
}
