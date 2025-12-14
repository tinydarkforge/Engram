#!/usr/bin/env node

/**
 * Git-Native Indexing for Neural Memory
 *
 * Indexes git commits across all known projects for semantic search.
 * This captures institutional knowledge that lives in commit history
 * without requiring manual `remember` calls.
 *
 * What gets indexed:
 * - Commit subject (type, scope, description from conventional commits)
 * - Commit body (extended description, issue refs)
 * - Changed file paths (provides context on what was touched)
 *
 * Usage:
 *   node index-git.js build              # Index all projects
 *   node index-git.js build --project X  # Index single project
 *   node index-git.js query "RAM leak"   # Search git history
 *   node index-git.js stats              # Show index statistics
 */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const msgpack = require('msgpack-lite');

const MEMEX_PATH = process.env.MEMEX_PATH || path.join(process.env.HOME, 'code/cirrus/DevOps/Memex');
const NEURAL_PATH = path.join(MEMEX_PATH, '.neural');
const GIT_INDEX_PATH = path.join(NEURAL_PATH, 'git-index.msgpack');

// Known projects to index (from CLAUDE.md)
// NOTE: Memex excluded - its commits are mostly automated session saves
const PROJECTS = {
  'CirrusTranslate': path.join(process.env.HOME, 'code/cirrus/CirrusTranslate'),
  'translate.hellocirrus': path.join(process.env.HOME, 'code/cirrus/translatehellocirrus'),
  'DevOps': path.join(process.env.HOME, 'code/cirrus/DevOps'),
  'MIRAGE': path.join(process.env.HOME, 'code/cirrus/MIRAGE'),
  'Aither': path.join(process.env.HOME, 'code/cirrus/Aither'),
};

// How far back to index
const DEFAULT_SINCE = '6 months ago';
const MAX_COMMITS_PER_PROJECT = 500;  // Prevent runaway on repos with many small commits

class GitIndexer {
  constructor() {
    this.vectorSearch = null;
    this.index = null;
  }

  /**
   * Extract commits from a git repository
   */
  extractCommits(repoPath, since = DEFAULT_SINCE) {
    if (!fs.existsSync(repoPath)) {
      return [];
    }

    // Check if it's a git repo
    const gitDir = path.join(repoPath, '.git');
    if (!fs.existsSync(gitDir)) {
      return [];
    }

    try {
      // Get commit data using a unique record separator
      // Format: hash<RS>subject<RS>date<RS>author<RS><RS> (double RS = record end)
      // Skip body entirely - it often contains problematic characters
      // and we get most value from subject + files anyway
      const RS = '\x1e';  // ASCII Record Separator
      const format = `%H${RS}%s${RS}%ai${RS}%an${RS}${RS}`;
      const logOutput = execSync(
        `git log --since="${since}" --format="${format}" --no-merges`,
        { cwd: repoPath, encoding: 'utf8', maxBuffer: 10 * 1024 * 1024 }
      );

      // Split by double RS (record boundaries)
      const records = logOutput.split(RS + RS).filter(r => r.trim());
      const commits = [];

      for (const record of records) {
        const parts = record.split(RS);
        if (parts.length < 4) continue;

        const [hash, subject, date, author] = parts;

        // Validate hash is a proper git hash (40 hex chars)
        const cleanHash = hash.trim();
        if (!/^[a-f0-9]{40}$/i.test(cleanHash)) continue;

        // Get changed files using diff-tree (safer than show)
        let files = [];
        try {
          const filesOutput = execSync(
            `git diff-tree --no-commit-id --name-only -r ${cleanHash}`,
            { cwd: repoPath, encoding: 'utf8' }
          );
          files = filesOutput.split('\n').filter(f => f.trim());
        } catch (e) {
          // Skip if can't get files
        }

        // Parse conventional commit format
        const parsed = this.parseConventionalCommit(subject);

        commits.push({
          hash: cleanHash.slice(0, 8),
          fullHash: cleanHash,
          subject,
          body: '',  // Skip body for safety
          date: date?.split(' ')[0] || '',  // Just YYYY-MM-DD
          author,
          files: files.slice(0, 20),  // Cap at 20 files
          type: parsed.type,
          scope: parsed.scope,
          description: parsed.description,
        });
      }

      // Apply max limit
      return commits.slice(0, MAX_COMMITS_PER_PROJECT);
    } catch (e) {
      console.error(`  Error extracting from ${repoPath}: ${e.message}`);
      return [];
    }
  }

  /**
   * Parse conventional commit format: type(scope): description
   */
  parseConventionalCommit(subject) {
    const match = subject.match(/^(\w+)(?:\(([^)]+)\))?:\s*(.+)$/);
    if (match) {
      return {
        type: match[1],
        scope: match[2] || null,
        description: match[3],
      };
    }
    return {
      type: null,
      scope: null,
      description: subject,
    };
  }

  /**
   * Build text for embedding
   * Combines commit info in a way that's searchable
   */
  buildEmbeddingText(commit, projectName) {
    const parts = [
      `[${projectName}]`,
      commit.subject,
    ];

    if (commit.body) {
      parts.push(commit.body.slice(0, 200));  // Cap body length
    }

    if (commit.files.length > 0) {
      parts.push(`Files: ${commit.files.join(', ')}`);
    }

    return parts.join(' ');
  }

  /**
   * Build index for all projects
   */
  async build(options = {}) {
    const { projects = Object.keys(PROJECTS), since = DEFAULT_SINCE } = options;

    console.log('🔍 Git-Native Indexing\n');

    // Ensure neural directory exists
    if (!fs.existsSync(NEURAL_PATH)) {
      fs.mkdirSync(NEURAL_PATH, { recursive: true });
    }

    // Initialize vector search
    const VectorSearch = require('./vector-search');
    this.vectorSearch = new VectorSearch();
    await this.vectorSearch.initialize();

    const allCommits = [];
    const projectStats = {};

    // Extract commits from each project
    for (const projectName of projects) {
      const repoPath = PROJECTS[projectName];
      if (!repoPath) {
        console.log(`  ⚠️  Unknown project: ${projectName}`);
        continue;
      }

      console.log(`  📂 ${projectName}...`);
      const commits = this.extractCommits(repoPath, since);

      if (commits.length > 0) {
        // Add project name to each commit
        commits.forEach(c => c.project = projectName);
        allCommits.push(...commits);
        projectStats[projectName] = commits.length;
        console.log(`     ✓ ${commits.length} commits`);
      } else {
        console.log(`     – no commits found`);
      }
    }

    if (allCommits.length === 0) {
      console.log('\n⚠️  No commits to index');
      return { total: 0 };
    }

    console.log(`\n🧠 Generating embeddings for ${allCommits.length} commits...`);

    // Generate embeddings
    const embeddings = {};
    let processed = 0;

    for (const commit of allCommits) {
      const text = this.buildEmbeddingText(commit, commit.project);
      const id = `git-${commit.project}-${commit.hash}`;

      try {
        const embedding = await this.vectorSearch.embed(text);
        embeddings[id] = {
          e: new Float32Array(embedding),
          h: commit.hash,
          p: commit.project,
          s: commit.subject.slice(0, 100),
          d: commit.date,
          t: commit.type,
          sc: commit.scope,
          f: commit.files.slice(0, 5),  // Top 5 files for search
        };
        processed++;
      } catch (e) {
        console.error(`  Error embedding ${commit.hash}: ${e.message}`);
      }

      // Progress indicator
      if (processed % 50 === 0) {
        process.stdout.write(`  ${processed}/${allCommits.length}\r`);
      }
    }

    console.log(`  ✓ ${processed} embeddings generated`);

    // Save index
    const index = {
      v: '1.0',
      built: new Date().toISOString(),
      since,
      dim: 384,
      commits: embeddings,
      stats: projectStats,
    };

    const buffer = msgpack.encode(index);
    fs.writeFileSync(GIT_INDEX_PATH, buffer);

    console.log(`\n✅ Index saved: ${Math.round(buffer.length / 1024)}KB`);
    console.log('\nProject breakdown:');
    for (const [proj, count] of Object.entries(projectStats)) {
      console.log(`  ${proj}: ${count} commits`);
    }

    return {
      total: processed,
      projects: projectStats,
      size: buffer.length,
    };
  }

  /**
   * Load the git index
   */
  loadIndex() {
    if (this.index) return this.index;

    if (!fs.existsSync(GIT_INDEX_PATH)) {
      return null;
    }

    const buffer = fs.readFileSync(GIT_INDEX_PATH);
    this.index = msgpack.decode(buffer);
    return this.index;
  }

  /**
   * Search git history semantically
   */
  async query(queryText, options = {}) {
    const { limit = 10, project = null, minSimilarity = 0.2 } = options;

    // Load index
    const index = this.loadIndex();
    if (!index) {
      return { error: 'Git index not built. Run: node index-git.js build' };
    }

    // Initialize vector search
    if (!this.vectorSearch) {
      const VectorSearch = require('./vector-search');
      this.vectorSearch = new VectorSearch();
      await this.vectorSearch.initialize();
    }

    // Generate query embedding
    const queryEmbedding = await this.vectorSearch.embed(queryText);

    // Search through commits
    const results = [];

    for (const [id, data] of Object.entries(index.commits)) {
      // Filter by project if specified
      if (project && data.p !== project) continue;

      // Calculate cosine similarity
      const similarity = this.cosineSimilarity(queryEmbedding, Array.from(data.e));

      if (similarity >= minSimilarity) {
        results.push({
          id,
          hash: data.h,
          project: data.p,
          subject: data.s,
          date: data.d,
          type: data.t,
          scope: data.sc,
          files: data.f,
          score: similarity,
        });
      }
    }

    // Sort by score and limit
    results.sort((a, b) => b.score - a.score);
    const topResults = results.slice(0, limit);

    return {
      query: queryText,
      results: topResults,
      total: results.length,
    };
  }

  /**
   * Cosine similarity between two vectors
   */
  cosineSimilarity(a, b) {
    let dotProduct = 0;
    let normA = 0;
    let normB = 0;

    for (let i = 0; i < a.length; i++) {
      dotProduct += a[i] * b[i];
      normA += a[i] * a[i];
      normB += b[i] * b[i];
    }

    return dotProduct / (Math.sqrt(normA) * Math.sqrt(normB));
  }

  /**
   * Get index statistics
   */
  getStats() {
    const index = this.loadIndex();
    if (!index) {
      return { error: 'Git index not built' };
    }

    const commits = Object.values(index.commits);
    const types = {};
    const projects = {};

    for (const commit of commits) {
      types[commit.t || 'other'] = (types[commit.t || 'other'] || 0) + 1;
      projects[commit.p] = (projects[commit.p] || 0) + 1;
    }

    return {
      version: index.v,
      built: index.built,
      since: index.since,
      total_commits: commits.length,
      by_type: types,
      by_project: projects,
      size_kb: Math.round(fs.statSync(GIT_INDEX_PATH).size / 1024),
    };
  }
}

// CLI
const command = process.argv[2];
const indexer = new GitIndexer();

(async () => {
  try {
    switch (command) {
      case 'build':
        const projectArg = process.argv.indexOf('--project');
        const sinceArg = process.argv.indexOf('--since');

        const buildOptions = {};
        if (projectArg > -1 && process.argv[projectArg + 1]) {
          buildOptions.projects = [process.argv[projectArg + 1]];
        }
        if (sinceArg > -1 && process.argv[sinceArg + 1]) {
          buildOptions.since = process.argv[sinceArg + 1];
        }

        await indexer.build(buildOptions);
        break;

      case 'query':
        const queryText = process.argv.slice(3).join(' ');
        if (!queryText) {
          console.error('Usage: index-git.js query <text>');
          process.exit(1);
        }

        console.log(`🔍 Searching git history: "${queryText}"\n`);
        const results = await indexer.query(queryText);

        if (results.error) {
          console.error(results.error);
          process.exit(1);
        }

        console.log(`Found ${results.total} matches (showing top ${results.results.length}):\n`);

        for (const r of results.results) {
          const score = `${Math.round(r.score * 100)}%`;
          const type = r.type ? `${r.type}` : '';
          const scope = r.scope ? `(${r.scope})` : '';
          console.log(`${score.padStart(4)} [${r.project}] ${r.hash} ${type}${scope}: ${r.subject}`);
          if (r.files.length > 0) {
            console.log(`      Files: ${r.files.join(', ')}`);
          }
        }
        break;

      case 'stats':
        const stats = indexer.getStats();
        if (stats.error) {
          console.error(stats.error);
          process.exit(1);
        }

        console.log('📊 Git Index Statistics\n');
        console.log(`Built: ${stats.built}`);
        console.log(`Since: ${stats.since}`);
        console.log(`Total commits: ${stats.total_commits}`);
        console.log(`Size: ${stats.size_kb}KB\n`);

        console.log('By project:');
        for (const [proj, count] of Object.entries(stats.by_project)) {
          console.log(`  ${proj}: ${count}`);
        }

        console.log('\nBy type:');
        for (const [type, count] of Object.entries(stats.by_type).sort((a, b) => b[1] - a[1])) {
          console.log(`  ${type}: ${count}`);
        }
        break;

      default:
        console.log('Git-Native Indexing for Neural Memory\n');
        console.log('Usage:');
        console.log('  node index-git.js build              Build index for all projects');
        console.log('  node index-git.js build --project X  Build index for single project');
        console.log('  node index-git.js build --since "3 months ago"');
        console.log('  node index-git.js query "RAM leak"   Search git history');
        console.log('  node index-git.js stats              Show index statistics');
    }
  } catch (error) {
    console.error('Error:', error.message);
    if (process.env.DEBUG) console.error(error.stack);
    process.exit(1);
  }
})();

module.exports = GitIndexer;
