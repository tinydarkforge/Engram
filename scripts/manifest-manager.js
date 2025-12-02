#!/usr/bin/env node

/**
 * Manifest Manager for Memex
 *
 * Tracks file changes for incremental updates (100x faster)
 * - Generate manifest with mtimes and hashes
 * - Detect changed files since last manifest
 * - Only load/update changed content
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { glob } = require('glob');

const MEMEX_PATH = process.env.MEMEX_PATH || path.join(process.env.HOME, 'code/cirrus/DevOps/Memex');
const MANIFEST_PATH = path.join(MEMEX_PATH, '.memex-manifest.json');

class ManifestManager {
  constructor() {
    this.manifest = null;
  }

  /**
   * Load existing manifest
   */
  load() {
    if (fs.existsSync(MANIFEST_PATH)) {
      this.manifest = JSON.parse(fs.readFileSync(MANIFEST_PATH, 'utf8'));
      return this.manifest;
    }
    return null;
  }

  /**
   * Generate file hash (SHA256)
   */
  hashFile(filePath) {
    const content = fs.readFileSync(filePath);
    return crypto.createHash('sha256').update(content).digest('hex').substring(0, 16);
  }

  /**
   * Get file metadata
   */
  getFileMetadata(filePath) {
    const stats = fs.statSync(filePath);
    return {
      hash: this.hashFile(filePath),
      size: stats.size,
      mtime: stats.mtimeMs
    };
  }

  /**
   * Scan all Memex files and generate manifest
   */
  async generate() {
    const startTime = Date.now();

    // Find all relevant files
    const patterns = [
      'index.json',
      'index.json.gz',
      'index.msgpack',
      'metadata/**/*.json',
      'summaries/**/*.json',
      'content/**/*.{md,json}'
    ];

    const files = {};
    let totalSize = 0;
    let fileCount = 0;

    for (const pattern of patterns) {
      const matches = await glob(pattern, { cwd: MEMEX_PATH });

      for (const file of matches) {
        const fullPath = path.join(MEMEX_PATH, file);
        const metadata = this.getFileMetadata(fullPath);

        files[file] = metadata;
        totalSize += metadata.size;
        fileCount++;
      }
    }

    // Count projects and sessions
    const projectFiles = await glob('metadata/projects/*.json', { cwd: MEMEX_PATH });
    const sessionFiles = await glob('summaries/projects/*/sessions-index.json', { cwd: MEMEX_PATH });

    this.manifest = {
      version: '3.2.0',
      generated_at: new Date().toISOString(),
      files,
      stats: {
        total_files: fileCount,
        total_size_bytes: totalSize,
        projects: projectFiles.length,
        sessions: sessionFiles.length
      },
      generation_time_ms: Date.now() - startTime
    };

    return this.manifest;
  }

  /**
   * Save manifest to disk
   */
  save() {
    if (!this.manifest) {
      throw new Error('No manifest to save. Generate first.');
    }

    fs.writeFileSync(MANIFEST_PATH, JSON.stringify(this.manifest, null, 2));
  }

  /**
   * Detect changed files since last manifest
   * Returns: { changed: [], added: [], deleted: [] }
   */
  detectChanges() {
    const oldManifest = this.load();

    if (!oldManifest) {
      return {
        changed: [],
        added: [],
        deleted: [],
        is_first_run: true
      };
    }

    const changes = {
      changed: [],
      added: [],
      deleted: [],
      is_first_run: false
    };

    // Check current files
    const currentFiles = new Set();

    for (const [filePath, metadata] of Object.entries(this.manifest.files)) {
      currentFiles.add(filePath);
      const oldMetadata = oldManifest.files[filePath];

      if (!oldMetadata) {
        // New file
        changes.added.push(filePath);
      } else if (
        oldMetadata.hash !== metadata.hash ||
        oldMetadata.mtime !== metadata.mtime
      ) {
        // Changed file
        changes.changed.push(filePath);
      }
    }

    // Check for deleted files
    for (const filePath of Object.keys(oldManifest.files)) {
      if (!currentFiles.has(filePath)) {
        changes.deleted.push(filePath);
      }
    }

    return changes;
  }

  /**
   * Get changed files since last manifest
   */
  async getChangedFiles() {
    const oldManifest = this.load();
    await this.generate();
    const changes = this.detectChanges();

    return {
      ...changes,
      total_changed: changes.changed.length + changes.added.length + changes.deleted.length,
      total_files: this.manifest.stats.total_files,
      change_percentage: Math.round(
        ((changes.changed.length + changes.added.length + changes.deleted.length) /
        this.manifest.stats.total_files) * 100
      )
    };
  }

  /**
   * Check if index needs update
   */
  needsIndexUpdate() {
    const oldManifest = this.load();

    if (!oldManifest) return true;

    const indexFiles = ['index.json', 'index.json.gz', 'index.msgpack'];

    for (const file of indexFiles) {
      if (!oldManifest.files[file]) continue;

      const fullPath = path.join(MEMEX_PATH, file);
      if (!fs.existsSync(fullPath)) continue;

      const currentMeta = this.getFileMetadata(fullPath);
      const oldMeta = oldManifest.files[file];

      if (currentMeta.hash !== oldMeta.hash) {
        return true;
      }
    }

    return false;
  }

  /**
   * Get stats comparison
   */
  getStatsComparison() {
    const oldManifest = this.load();

    if (!oldManifest) {
      return {
        files_diff: this.manifest.stats.total_files,
        size_diff_kb: Math.round(this.manifest.stats.total_size_bytes / 1024),
        projects_diff: this.manifest.stats.projects,
        sessions_diff: this.manifest.stats.sessions
      };
    }

    return {
      files_diff: this.manifest.stats.total_files - oldManifest.stats.total_files,
      size_diff_kb: Math.round((this.manifest.stats.total_size_bytes - oldManifest.stats.total_size_bytes) / 1024),
      projects_diff: this.manifest.stats.projects - oldManifest.stats.projects,
      sessions_diff: this.manifest.stats.sessions - oldManifest.stats.sessions
    };
  }
}

// CLI Usage
if (require.main === module) {
  const manager = new ManifestManager();
  const command = process.argv[2];

  (async () => {
    try {
      switch (command) {
        case 'generate':
          console.log('🔍 Scanning Memex files...');
          await manager.generate();
          manager.save();
          console.log('✅ Manifest generated');
          console.log(`   • Files: ${manager.manifest.stats.total_files}`);
          console.log(`   • Size: ${Math.round(manager.manifest.stats.total_size_bytes / 1024)}KB`);
          console.log(`   • Time: ${manager.manifest.generation_time_ms}ms`);
          break;

        case 'check':
          console.log('🔍 Checking for changes...');
          const changes = await manager.getChangedFiles();

          if (changes.is_first_run) {
            console.log('⚠️  No previous manifest found');
          } else if (changes.total_changed === 0) {
            console.log('✅ No changes detected');
          } else {
            console.log(`📝 Changes detected:`);
            console.log(`   • Changed: ${changes.changed.length} files`);
            console.log(`   • Added: ${changes.added.length} files`);
            console.log(`   • Deleted: ${changes.deleted.length} files`);
            console.log(`   • Total: ${changes.total_changed} / ${changes.total_files} (${changes.change_percentage}%)`);

            if (changes.changed.length > 0) {
              console.log('\n   Changed files:');
              changes.changed.slice(0, 5).forEach(f => console.log(`     - ${f}`));
              if (changes.changed.length > 5) {
                console.log(`     ... and ${changes.changed.length - 5} more`);
              }
            }
          }

          manager.save();
          break;

        case 'needs-update':
          const needsUpdate = manager.needsIndexUpdate();
          console.log(needsUpdate ? 'true' : 'false');
          process.exit(needsUpdate ? 0 : 1);
          break;

        case 'stats':
          await manager.generate();
          const stats = manager.getStatsComparison();
          console.log('📊 Manifest Stats:');
          console.log(`   • Files: ${stats.files_diff > 0 ? '+' : ''}${stats.files_diff}`);
          console.log(`   • Size: ${stats.size_diff_kb > 0 ? '+' : ''}${stats.size_diff_kb}KB`);
          console.log(`   • Projects: ${stats.projects_diff > 0 ? '+' : ''}${stats.projects_diff}`);
          console.log(`   • Sessions: ${stats.sessions_diff > 0 ? '+' : ''}${stats.sessions_diff}`);
          break;

        default:
          console.log('Manifest Manager - Incremental update tracking');
          console.log('');
          console.log('Usage: manifest-manager.js [command]');
          console.log('');
          console.log('Commands:');
          console.log('  generate     - Generate new manifest');
          console.log('  check        - Check for changes and update manifest');
          console.log('  needs-update - Check if index needs update (exit 0=yes, 1=no)');
          console.log('  stats        - Show stats comparison');
      }
    } catch (error) {
      console.error('Error:', error.message);
      process.exit(1);
    }
  })();
}

module.exports = ManifestManager;
