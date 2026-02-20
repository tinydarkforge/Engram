#!/usr/bin/env node

/**
 * Neural Memory - Streamlined
 *
 * Just git commit search. That's what works.
 * The session-based stuff wasn't being used.
 *
 * Usage:
 *   node neural-memory.js search "query"  # Search git history
 *   node neural-memory.js build           # Rebuild git index
 *   node neural-memory.js stats           # Show index stats
 */

const fs = require('fs');
const path = require('path');
const { resolveMemexPath } = require('./paths');

const MEMEX_PATH = resolveMemexPath(__dirname);
const NEURAL_PATH = path.join(MEMEX_PATH, '.neural');
const GIT_INDEX_PATH = path.join(NEURAL_PATH, 'git-index.msgpack');

// CLI
const command = process.argv[2];

(async () => {
  try {
    switch (command) {
      case 'build':
        console.log('🔄 Building git index...\n');

        // Ensure directory
        if (!fs.existsSync(NEURAL_PATH)) {
          fs.mkdirSync(NEURAL_PATH, { recursive: true });
        }

        const GitIndexer = require('./index-git');
        const indexer = new GitIndexer();
        const result = await indexer.build({ since: '6 months ago' });

        console.log(`\n✅ Done: ${result.total} commits indexed`);
        break;

      case 'search':
      case 'query':
        const queryText = process.argv.slice(3).join(' ');
        if (!queryText) {
          console.error('Usage: neural-memory.js search <query>');
          process.exit(1);
        }

        console.log(`🔍 Searching: "${queryText}"\n`);

        const GitIndexer2 = require('./index-git');
        const searcher = new GitIndexer2();
        const searchResult = await searcher.query(queryText, { limit: 10 });

        if (searchResult.error) {
          console.error(searchResult.error);
          process.exit(1);
        }

        if (searchResult.results.length === 0) {
          console.log('No results found');
        } else {
          console.log(`Found ${searchResult.total} matches:\n`);
          for (const r of searchResult.results) {
            const score = `${Math.round(r.score * 100)}%`;
            const type = r.type || '';
            const scope = r.scope ? `(${r.scope})` : '';
            console.log(`${score.padStart(4)} [${r.project}] ${r.hash} ${type}${scope}`);
            console.log(`     ${r.subject}`);
            if (r.files?.length > 0) {
              console.log(`     Files: ${r.files.slice(0, 3).join(', ')}`);
            }
          }
        }
        break;

      case 'stats':
        if (!fs.existsSync(GIT_INDEX_PATH)) {
          console.log('No index found. Run: neural-memory.js build');
          process.exit(1);
        }

        const GitIndexer3 = require('./index-git');
        const statsIndexer = new GitIndexer3();
        const stats = statsIndexer.getStats();

        console.log('📊 Neural Memory Stats\n');
        console.log(`Built: ${stats.built}`);
        console.log(`Since: ${stats.since}`);
        console.log(`Commits: ${stats.total_commits}`);
        console.log(`Size: ${stats.size_kb}KB\n`);

        console.log('By project:');
        for (const [proj, count] of Object.entries(stats.by_project || {})) {
          console.log(`  ${proj}: ${count}`);
        }
        break;

      default:
        console.log('Neural Memory - Git Search\n');
        console.log('Usage:');
        console.log('  node neural-memory.js search "query"  # Search git history');
        console.log('  node neural-memory.js build           # Rebuild git index');
        console.log('  node neural-memory.js stats           # Show index stats\n');
        console.log('Examples:');
        console.log('  node neural-memory.js search "memory leak"');
        console.log('  node neural-memory.js search "authentication fix"');
    }
  } catch (error) {
    console.error('Error:', error.message);
    if (process.env.DEBUG) console.error(error.stack);
    process.exit(1);
  }
})();
