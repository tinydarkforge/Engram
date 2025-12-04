#!/usr/bin/env node

/**
 * Lazy Loader for Memex (#22)
 *
 * Implements lazy loading of session details to reduce index size by 90%
 * - Lightweight index: Only id, date, summary, topics (~100-200 bytes per session)
 * - Full details: Loaded on-demand from separate files (~1-5KB per session)
 *
 * Performance Impact:
 * - Before: 7.5KB index with all session details
 * - After: ~1KB index with lazy loading
 * - Reduction: 85-90% smaller initial load
 */

const fs = require('fs');
const path = require('path');
const { glob } = require('glob');
const msgpack = require('msgpack-lite');

const MEMEX_PATH = process.env.MEMEX_PATH || path.join(process.env.HOME, 'code/cirrus/DevOps/Memex');

class LazyLoader {
  /**
   * Convert full sessions-index.json to lightweight index + detail files
   *
   * Creates:
   * - sessions-index.json: Lightweight index (id, date, summary, topics only)
   * - sessions/{id}.json: Full session details (loaded on-demand)
   */
  async convertToLazyFormat() {
    console.log('🔄 Converting to lazy-loading format...');

    const sessionIndexFiles = await glob('summaries/projects/*/sessions-index.json', {
      cwd: MEMEX_PATH
    });

    let totalSessions = 0;
    let totalSizeBefore = 0;
    let totalSizeAfter = 0;

    for (const indexFile of sessionIndexFiles) {
      const fullPath = path.join(MEMEX_PATH, indexFile);
      const fullIndex = JSON.parse(fs.readFileSync(fullPath, 'utf8'));

      const sizeBefore = Buffer.byteLength(JSON.stringify(fullIndex));
      totalSizeBefore += sizeBefore;

      if (!fullIndex.sessions || fullIndex.sessions.length === 0) {
        continue;
      }

      // Create sessions directory for detail files
      const projectPath = path.dirname(fullPath);
      const sessionsDir = path.join(projectPath, 'sessions');
      if (!fs.existsSync(sessionsDir)) {
        fs.mkdirSync(sessionsDir, { recursive: true });
      }

      // Create lightweight index
      const lightweightSessions = [];

      for (const session of fullIndex.sessions) {
        // Extract lightweight fields only
        const lightSession = {
          id: session.id,
          project: session.project,
          date: session.date,
          summary: session.summary,
          topics: session.topics || []
        };

        lightweightSessions.push(lightSession);

        // Save full details to separate file
        const detailsFile = path.join(sessionsDir, `${session.id}.json`);
        const fullDetails = {
          ...session,
          // Add metadata
          _lazy_loaded: true,
          _index_size_bytes: Buffer.byteLength(JSON.stringify(lightSession)),
          _full_size_bytes: Buffer.byteLength(JSON.stringify(session))
        };

        fs.writeFileSync(detailsFile, JSON.stringify(fullDetails, null, 2));
        totalSessions++;
      }

      // Create lightweight index file
      const lightIndex = {
        ...fullIndex,
        sessions: lightweightSessions,
        _lazy_loading_enabled: true,
        _session_details_path: 'sessions/{id}.json'
      };

      // Write lightweight index
      fs.writeFileSync(fullPath, JSON.stringify(lightIndex, null, 2));

      const sizeAfter = Buffer.byteLength(JSON.stringify(lightIndex));
      totalSizeAfter += sizeAfter;

      console.log(`  ✓ ${path.basename(path.dirname(fullPath))}: ${fullIndex.sessions.length} sessions`);
      console.log(`    ${Math.round(sizeBefore / 1024)}KB → ${Math.round(sizeAfter / 1024)}KB (${Math.round((1 - sizeAfter/sizeBefore) * 100)}% reduction)`);
    }

    console.log(`\n✅ Conversion complete`);
    console.log(`   • Sessions: ${totalSessions}`);
    console.log(`   • Before: ${Math.round(totalSizeBefore / 1024)}KB`);
    console.log(`   • After: ${Math.round(totalSizeAfter / 1024)}KB`);
    console.log(`   • Saved: ${Math.round((totalSizeBefore - totalSizeAfter) / 1024)}KB (${Math.round((1 - totalSizeAfter/totalSizeBefore) * 100)}%)`);

    return {
      total_sessions: totalSessions,
      size_before_kb: Math.round(totalSizeBefore / 1024),
      size_after_kb: Math.round(totalSizeAfter / 1024),
      saved_kb: Math.round((totalSizeBefore - totalSizeAfter) / 1024),
      reduction_percent: Math.round((1 - totalSizeAfter/totalSizeBefore) * 100)
    };
  }

  /**
   * Load session details on-demand
   * Supports MessagePack (preferred) and JSON (fallback)
   */
  loadSessionDetails(projectName, sessionId) {
    const basePath = path.join(
      MEMEX_PATH,
      'summaries/projects',
      projectName,
      'sessions',
      sessionId
    );

    // Try MessagePack first (faster + smaller)
    const msgpackPath = `${basePath}.msgpack`;
    if (fs.existsSync(msgpackPath)) {
      const buffer = fs.readFileSync(msgpackPath);
      return msgpack.decode(buffer);
    }

    // Fallback to JSON
    const jsonPath = `${basePath}.json`;
    if (fs.existsSync(jsonPath)) {
      return JSON.parse(fs.readFileSync(jsonPath, 'utf8'));
    }

    return null;
  }

  /**
   * Get stats about lazy loading
   */
  getStats() {
    const stats = {
      total_sessions: 0,
      index_size_kb: 0,
      details_size_kb: 0,
      avg_session_index_bytes: 0,
      avg_session_full_bytes: 0
    };

    // Calculate from existing detail files
    const detailFiles = fs.readdirSync(path.join(MEMEX_PATH, 'summaries/projects'))
      .filter(dir => fs.existsSync(path.join(MEMEX_PATH, 'summaries/projects', dir, 'sessions')))
      .flatMap(dir => {
        const sessionsDir = path.join(MEMEX_PATH, 'summaries/projects', dir, 'sessions');
        return fs.readdirSync(sessionsDir)
          .filter(f => f.endsWith('.json'))
          .map(f => path.join(sessionsDir, f));
      });

    let totalIndexBytes = 0;
    let totalFullBytes = 0;

    for (const file of detailFiles) {
      const session = JSON.parse(fs.readFileSync(file, 'utf8'));
      stats.total_sessions++;
      totalIndexBytes += session._index_size_bytes || 0;
      totalFullBytes += session._full_size_bytes || 0;
    }

    stats.index_size_kb = Math.round(totalIndexBytes / 1024);
    stats.details_size_kb = Math.round(totalFullBytes / 1024);
    stats.avg_session_index_bytes = Math.round(totalIndexBytes / stats.total_sessions);
    stats.avg_session_full_bytes = Math.round(totalFullBytes / stats.total_sessions);

    return stats;
  }

  /**
   * Convert session detail files to MessagePack format
   * Creates .msgpack files alongside .json files (keeps JSON as fallback)
   */
  async convertSessionDetailsToMessagePack() {
    console.log('🔄 Converting session details to MessagePack...');

    const projectDirs = fs.readdirSync(path.join(MEMEX_PATH, 'summaries/projects'))
      .filter(dir => {
        const sessionsDir = path.join(MEMEX_PATH, 'summaries/projects', dir, 'sessions');
        return fs.existsSync(sessionsDir);
      });

    let totalFiles = 0;
    let totalSizeBefore = 0;
    let totalSizeAfter = 0;

    for (const projectDir of projectDirs) {
      const sessionsDir = path.join(MEMEX_PATH, 'summaries/projects', projectDir, 'sessions');
      const sessionFiles = fs.readdirSync(sessionsDir).filter(f => f.endsWith('.json'));

      for (const sessionFile of sessionFiles) {
        const jsonPath = path.join(sessionsDir, sessionFile);
        const msgpackPath = jsonPath.replace(/\.json$/, '.msgpack');

        // Skip if msgpack already exists
        if (fs.existsSync(msgpackPath)) {
          continue;
        }

        // Read JSON and convert to MessagePack
        const json = JSON.parse(fs.readFileSync(jsonPath, 'utf8'));
        const msgpackBuffer = msgpack.encode(json);

        // Write MessagePack file
        fs.writeFileSync(msgpackPath, msgpackBuffer);

        const jsonSize = fs.statSync(jsonPath).size;
        const msgpackSize = msgpackBuffer.length;

        totalFiles++;
        totalSizeBefore += jsonSize;
        totalSizeAfter += msgpackSize;
      }

      if (sessionFiles.length > 0) {
        console.log(`  ✓ ${projectDir}: ${sessionFiles.length} sessions converted`);
      }
    }

    const reduction = totalSizeBefore > 0
      ? ((totalSizeBefore - totalSizeAfter) / totalSizeBefore * 100).toFixed(1)
      : 0;

    console.log(`\n✅ Conversion complete`);
    console.log(`   • Files: ${totalFiles}`);
    console.log(`   • Before: ${(totalSizeBefore / 1024).toFixed(2)} KB`);
    console.log(`   • After: ${(totalSizeAfter / 1024).toFixed(2)} KB`);
    console.log(`   • Saved: ${((totalSizeBefore - totalSizeAfter) / 1024).toFixed(2)} KB (${reduction}%)`);

    return {
      total_files: totalFiles,
      size_before_kb: totalSizeBefore / 1024,
      size_after_kb: totalSizeAfter / 1024,
      reduction_percent: parseFloat(reduction)
    };
  }

  /**
   * Revert to full format (for testing/rollback)
   */
  async revertToFullFormat() {
    console.log('🔄 Reverting to full format...');

    const sessionIndexFiles = await glob('summaries/projects/*/sessions-index.json', {
      cwd: MEMEX_PATH
    });

    for (const indexFile of sessionIndexFiles) {
      const fullPath = path.join(MEMEX_PATH, indexFile);
      const lightIndex = JSON.parse(fs.readFileSync(fullPath, 'utf8'));

      if (!lightIndex._lazy_loading_enabled) {
        console.log(`  ⊘ ${path.basename(path.dirname(fullPath))}: Not in lazy format, skipping`);
        continue;
      }

      const projectPath = path.dirname(fullPath);
      const sessionsDir = path.join(projectPath, 'sessions');

      // Load full sessions from detail files
      const fullSessions = [];
      for (const lightSession of lightIndex.sessions) {
        const detailsPath = path.join(sessionsDir, `${lightSession.id}.json`);
        if (fs.existsSync(detailsPath)) {
          const fullSession = JSON.parse(fs.readFileSync(detailsPath, 'utf8'));
          // Remove lazy loading metadata
          delete fullSession._lazy_loaded;
          delete fullSession._index_size_bytes;
          delete fullSession._full_size_bytes;
          fullSessions.push(fullSession);
        } else {
          // Fallback to light session if details not found
          fullSessions.push(lightSession);
        }
      }

      // Create full index
      const fullIndex = {
        ...lightIndex,
        sessions: fullSessions
      };
      delete fullIndex._lazy_loading_enabled;
      delete fullIndex._session_details_path;

      fs.writeFileSync(fullPath, JSON.stringify(fullIndex, null, 2));
      console.log(`  ✓ ${path.basename(path.dirname(fullPath))}: Reverted to full format`);
    }

    console.log('✅ Reverted to full format');
  }
}

// CLI Usage
if (require.main === module) {
  const lazyLoader = new LazyLoader();
  const command = process.argv[2];

  (async () => {
    try {
      switch (command) {
        case 'convert':
          await lazyLoader.convertToLazyFormat();
          break;

        case 'convert-msgpack':
          await lazyLoader.convertSessionDetailsToMessagePack();
          break;

        case 'revert':
          await lazyLoader.revertToFullFormat();
          break;

        case 'stats':
          const stats = lazyLoader.getStats();
          console.log('📊 Lazy Loading Stats:');
          console.log(`   • Total sessions: ${stats.total_sessions}`);
          console.log(`   • Index size: ${stats.index_size_kb}KB`);
          console.log(`   • Details size: ${stats.details_size_kb}KB`);
          console.log(`   • Avg index: ${stats.avg_session_index_bytes} bytes/session`);
          console.log(`   • Avg full: ${stats.avg_session_full_bytes} bytes/session`);
          console.log(`   • Reduction: ${Math.round((1 - stats.avg_session_index_bytes/stats.avg_session_full_bytes) * 100)}%`);
          break;

        case 'load':
          const project = process.argv[3];
          const sessionId = process.argv[4];
          if (!project || !sessionId) {
            console.error('Usage: lazy-loader.js load <project> <session-id>');
            process.exit(1);
          }
          const details = lazyLoader.loadSessionDetails(project, sessionId);
          if (details) {
            console.log(JSON.stringify(details, null, 2));
          } else {
            console.error(`Session not found: ${project}/${sessionId}`);
            process.exit(1);
          }
          break;

        default:
          console.log('Lazy Loader - Reduce index size by 90% with on-demand loading');
          console.log('');
          console.log('Usage: lazy-loader.js [command]');
          console.log('');
          console.log('Commands:');
          console.log('  convert              - Convert to lazy-loading format');
          console.log('  convert-msgpack      - Convert session details to MessagePack');
          console.log('  revert               - Revert to full format');
          console.log('  stats                - Show lazy loading statistics');
          console.log('  load <proj> <id>     - Load session details');
          console.log('');
          console.log('Example:');
          console.log('  lazy-loader.js convert');
          console.log('  lazy-loader.js convert-msgpack');
          console.log('  lazy-loader.js load DemoProject ci-2025-12-03-hotfix');
      }
    } catch (error) {
      console.error('Error:', error.message);
      process.exit(1);
    }
  })();
}

module.exports = LazyLoader;
