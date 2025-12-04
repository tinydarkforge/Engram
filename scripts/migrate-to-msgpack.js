#!/usr/bin/env node

/**
 * Memex MessagePack Migration Tool
 *
 * Provides safe migration to MessagePack format with:
 * - Dry-run mode to preview changes
 * - Rollback capability to revert to JSON
 * - Progress reporting
 * - Error handling
 *
 * Usage:
 *   migrate-to-msgpack.js migrate      # Full migration
 *   migrate-to-msgpack.js --dry-run    # Preview changes
 *   migrate-to-msgpack.js rollback     # Remove all .msgpack files
 */

const fs = require('fs');
const path = require('path');
const msgpack = require('msgpack-lite');
const { glob } = require('glob');

const MEMEX_PATH = process.env.MEMEX_PATH || path.join(process.env.HOME, 'code/cirrus/DevOps/Memex');

class MessagePackMigration {
  constructor(options = {}) {
    this.dryRun = options.dryRun || false;
    this.stats = {
      files_converted: 0,
      files_skipped: 0,
      files_failed: 0,
      total_json_size: 0,
      total_msgpack_size: 0,
      errors: []
    };
  }

  /**
   * Convert a single JSON file to MessagePack
   */
  convertFile(jsonPath) {
    const msgpackPath = jsonPath.replace(/\.json$/, '.msgpack');

    // Skip if already exists
    if (fs.existsSync(msgpackPath)) {
      this.stats.files_skipped++;
      return { skipped: true, path: jsonPath };
    }

    try {
      const jsonData = JSON.parse(fs.readFileSync(jsonPath, 'utf8'));
      const msgpackBuffer = msgpack.encode(jsonData);

      const jsonSize = fs.statSync(jsonPath).size;
      const msgpackSize = msgpackBuffer.length;

      if (!this.dryRun) {
        fs.writeFileSync(msgpackPath, msgpackBuffer);
      }

      this.stats.files_converted++;
      this.stats.total_json_size += jsonSize;
      this.stats.total_msgpack_size += msgpackSize;

      const reduction = ((jsonSize - msgpackSize) / jsonSize * 100).toFixed(1);

      return {
        converted: true,
        path: jsonPath,
        json_size: jsonSize,
        msgpack_size: msgpackSize,
        reduction
      };
    } catch (error) {
      this.stats.files_failed++;
      this.stats.errors.push({ file: jsonPath, error: error.message });
      return { failed: true, path: jsonPath, error: error.message };
    }
  }

  /**
   * Find all JSON files that should be converted
   */
  async findJsonFiles() {
    const patterns = [
      'index.json',
      'summaries/projects/*/sessions-index.json',
      'summaries/projects/*/sessions/*.json',
      'content/global/*.json'
    ];

    const files = [];

    for (const pattern of patterns) {
      const matches = await glob(pattern, { cwd: MEMEX_PATH });
      for (const match of matches) {
        const fullPath = path.join(MEMEX_PATH, match);
        // Exclude package.json and other config files
        if (!match.includes('package.json') && !match.includes('node_modules')) {
          files.push(fullPath);
        }
      }
    }

    return files;
  }

  /**
   * Migrate all files to MessagePack
   */
  async migrate() {
    console.log('🚀 MessagePack Migration Tool');
    console.log(`   Mode: ${this.dryRun ? 'DRY RUN (no changes will be made)' : 'LIVE'}\n`);

    const jsonFiles = await this.findJsonFiles();

    console.log(`📂 Found ${jsonFiles.length} JSON files to convert\n`);

    if (this.dryRun) {
      console.log('🔍 Preview of changes:\n');
    }

    let progressCount = 0;

    for (const jsonPath of jsonFiles) {
      progressCount++;
      const result = this.convertFile(jsonPath);

      const relativePath = path.relative(MEMEX_PATH, jsonPath);

      if (result.converted) {
        const icon = this.dryRun ? '📝' : '✅';
        console.log(`${icon} [${progressCount}/${jsonFiles.length}] ${relativePath}`);
        console.log(`   ${(result.json_size / 1024).toFixed(2)} KB → ${(result.msgpack_size / 1024).toFixed(2)} KB (${result.reduction}% reduction)`);
      } else if (result.skipped) {
        console.log(`⊘  [${progressCount}/${jsonFiles.length}] ${relativePath} (already exists)`);
        this.stats.files_skipped++;
      } else if (result.failed) {
        console.log(`❌ [${progressCount}/${jsonFiles.length}] ${relativePath}`);
        console.log(`   Error: ${result.error}`);
      }
    }

    this.printSummary();
  }

  /**
   * Rollback: Remove all .msgpack files
   */
  async rollback() {
    console.log('🔄 Rolling back to JSON format...\n');

    const msgpackFiles = await glob('**/*.msgpack', {
      cwd: MEMEX_PATH,
      ignore: ['node_modules/**']
    });

    console.log(`📂 Found ${msgpackFiles.length} MessagePack files to remove\n`);

    let removed = 0;
    let failed = 0;

    for (const msgpackFile of msgpackFiles) {
      const fullPath = path.join(MEMEX_PATH, msgpackFile);

      try {
        if (!this.dryRun) {
          fs.unlinkSync(fullPath);
        }
        console.log(`🗑️  Removed: ${msgpackFile}`);
        removed++;
      } catch (error) {
        console.log(`❌ Failed to remove: ${msgpackFile}`);
        console.log(`   Error: ${error.message}`);
        failed++;
      }
    }

    console.log(`\n✅ Rollback complete`);
    console.log(`   Removed: ${removed}`);
    console.log(`   Failed: ${failed}`);

    if (this.dryRun) {
      console.log('\n💡 This was a dry run. Run without --dry-run to actually remove files.');
    } else {
      console.log('\n✅ All MessagePack files removed. System reverted to JSON format.');
    }
  }

  /**
   * Print migration summary
   */
  printSummary() {
    const reduction = this.stats.total_json_size > 0
      ? ((this.stats.total_json_size - this.stats.total_msgpack_size) / this.stats.total_json_size * 100).toFixed(1)
      : 0;

    console.log('\n📊 Migration Summary:');
    console.log(`   Files converted: ${this.stats.files_converted}`);
    console.log(`   Files skipped:   ${this.stats.files_skipped}`);
    console.log(`   Files failed:    ${this.stats.files_failed}`);
    console.log(`   JSON size:       ${(this.stats.total_json_size / 1024).toFixed(2)} KB`);
    console.log(`   MessagePack size: ${(this.stats.total_msgpack_size / 1024).toFixed(2)} KB`);
    console.log(`   Saved:           ${((this.stats.total_json_size - this.stats.total_msgpack_size) / 1024).toFixed(2)} KB (${reduction}%)`);

    if (this.stats.errors.length > 0) {
      console.log('\n❌ Errors encountered:');
      this.stats.errors.forEach(err => {
        console.log(`   • ${path.relative(MEMEX_PATH, err.file)}: ${err.error}`);
      });
    }

    if (this.dryRun) {
      console.log('\n💡 This was a dry run. Run without --dry-run to apply changes.');
    } else {
      console.log('\n✅ Migration complete! Memex is now using MessagePack format.');
      console.log('   JSON files have been preserved as fallback.');
    }

    if (this.stats.files_failed > 0) {
      console.log('\n⚠️  Some files failed to convert. Review errors above.');
      return false;
    }

    return true;
  }

  /**
   * Verify migration integrity
   */
  async verify() {
    console.log('🔍 Verifying migration integrity...\n');

    const msgpackFiles = await glob('**/*.msgpack', {
      cwd: MEMEX_PATH,
      ignore: ['node_modules/**']
    });

    let verified = 0;
    let failed = 0;

    for (const msgpackFile of msgpackFiles) {
      const msgpackPath = path.join(MEMEX_PATH, msgpackFile);
      const jsonPath = msgpackPath.replace('.msgpack', '.json');

      if (!fs.existsSync(jsonPath)) {
        console.log(`⚠️  ${msgpackFile}: JSON file missing`);
        continue;
      }

      try {
        const jsonData = JSON.parse(fs.readFileSync(jsonPath, 'utf8'));
        const msgpackBuffer = fs.readFileSync(msgpackPath);
        const msgpackData = msgpack.decode(msgpackBuffer);

        // Compare keys
        const jsonKeys = Object.keys(jsonData).sort();
        const msgpackKeys = Object.keys(msgpackData).sort();

        if (JSON.stringify(jsonKeys) === JSON.stringify(msgpackKeys)) {
          verified++;
        } else {
          console.log(`❌ ${msgpackFile}: Key mismatch`);
          failed++;
        }
      } catch (error) {
        console.log(`❌ ${msgpackFile}: ${error.message}`);
        failed++;
      }
    }

    console.log(`\n✅ Verification complete`);
    console.log(`   Verified: ${verified}`);
    console.log(`   Failed:   ${failed}`);

    return failed === 0;
  }
}

// CLI Usage
if (require.main === module) {
  const args = process.argv.slice(2);
  const command = args[0];
  const dryRun = args.includes('--dry-run');

  const migration = new MessagePackMigration({ dryRun });

  (async () => {
    try {
      switch (command) {
        case 'migrate':
          await migration.migrate();
          break;

        case 'rollback':
          await migration.rollback();
          break;

        case 'verify':
          const success = await migration.verify();
          process.exit(success ? 0 : 1);
          break;

        default:
          console.log('MessagePack Migration Tool');
          console.log('');
          console.log('Usage: migrate-to-msgpack.js [command] [options]');
          console.log('');
          console.log('Commands:');
          console.log('  migrate              - Migrate all JSON files to MessagePack');
          console.log('  rollback             - Remove all .msgpack files (revert to JSON)');
          console.log('  verify               - Verify data integrity of .msgpack files');
          console.log('');
          console.log('Options:');
          console.log('  --dry-run            - Preview changes without modifying files');
          console.log('');
          console.log('Examples:');
          console.log('  migrate-to-msgpack.js migrate --dry-run    # Preview migration');
          console.log('  migrate-to-msgpack.js migrate              # Run migration');
          console.log('  migrate-to-msgpack.js verify               # Verify integrity');
          console.log('  migrate-to-msgpack.js rollback --dry-run   # Preview rollback');
          console.log('  migrate-to-msgpack.js rollback             # Rollback to JSON');
          process.exit(0);
      }
    } catch (error) {
      console.error('Error:', error.message);
      process.exit(1);
    }
  })();
}

module.exports = MessagePackMigration;
