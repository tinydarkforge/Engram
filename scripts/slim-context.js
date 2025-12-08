#!/usr/bin/env node

/**
 * Slim Context Generator v1.0
 * Creates ultra-compact context for Claude (~2KB vs 15KB)
 *
 * Usage:
 *   node slim-context.js generate    # Create slim-context.json
 *   node slim-context.js show        # Display current context
 *   node slim-context.js cleanup     # Slim down sessions-index files
 */

const fs = require('fs');
const path = require('path');

const MEMEX_PATH = process.env.MEMEX_PATH || path.join(process.env.HOME, 'code/cirrus/DevOps/Memex');

class SlimContext {
  constructor() {
    this.indexPath = path.join(MEMEX_PATH, 'index.json');
    this.outputPath = path.join(MEMEX_PATH, 'slim-context.json');
  }

  /**
   * Generate ultra-slim context from full index
   * Target: <2KB with everything Claude needs
   */
  generate() {
    const index = JSON.parse(fs.readFileSync(this.indexPath, 'utf8'));

    const slim = {
      // Version and timestamp (for cache invalidation)
      v: "1.0",
      ts: new Date().toISOString().split('T')[0],

      // Quick refs - most used, inline for instant access
      qr: {
        commit: {
          fmt: "<type>(<scope>): <description>",
          types: "feat|fix|docs|style|refactor|test|chore|perf|ci",
          ex: "feat(auth): add OAuth2 login"
        },
        pr: ["tests", "self-review", "lint", "typecheck", "build", "1 approval"],
        branch: {
          main: "prod",
          staging: "QA",
          develop: "dev",
          "feature/*": "features"
        }
      },

      // Projects - minimal info + deploy commands
      projects: {},

      // Recent sessions - last 3 per project, summary only
      recent: {}
    };

    // Extract minimal project info
    for (const [key, proj] of Object.entries(index.p)) {
      slim.projects[key] = {
        desc: proj.d,
        tech: proj.ts.slice(0, 3).join(", "),
        sessions: proj.sc
      };

      // Add quick deploy info if available
      if (proj.qr?.deploy) {
        slim.projects[key].deploy = {
          stg: proj.qr.deploy.stg,
          prd: proj.qr.deploy.prd
        };
      }
      if (proj.qr?.env) {
        slim.projects[key].env = proj.qr.env;
      }
    }

    // Load recent sessions (last 3 per project)
    const projectsDir = path.join(MEMEX_PATH, 'summaries/projects');
    if (fs.existsSync(projectsDir)) {
      for (const projName of fs.readdirSync(projectsDir)) {
        const sessionsIndexPath = path.join(projectsDir, projName, 'sessions-index.json');
        if (fs.existsSync(sessionsIndexPath)) {
          try {
            const sessionsIndex = JSON.parse(fs.readFileSync(sessionsIndexPath, 'utf8'));
            if (sessionsIndex.sessions && sessionsIndex.sessions.length > 0) {
              // Get last 3 sessions, slim format
              slim.recent[projName] = sessionsIndex.sessions
                .filter(s => s.summary && s.summary.length > 10) // Skip junk sessions
                .slice(0, 3)
                .map(s => ({
                  d: s.date,
                  s: s.summary.slice(0, 80), // Truncate long summaries
                  t: (s.topics || []).filter(t => t && t.length > 0).slice(0, 3) // Remove empty topics
                }));
            }
          } catch (e) {
            // Skip on error
          }
        }
      }
    }

    // Calculate size
    const jsonStr = JSON.stringify(slim, null, 2);
    const compactStr = JSON.stringify(slim);

    fs.writeFileSync(this.outputPath, jsonStr);

    return {
      output: this.outputPath,
      size_formatted: jsonStr.length,
      size_compact: compactStr.length,
      projects: Object.keys(slim.projects).length,
      recent_sessions: Object.values(slim.recent).flat().length
    };
  }

  /**
   * Display current slim context
   */
  show() {
    if (!fs.existsSync(this.outputPath)) {
      console.log('No slim-context.json found. Run: node slim-context.js generate');
      return null;
    }

    const context = JSON.parse(fs.readFileSync(this.outputPath, 'utf8'));
    return context;
  }

  /**
   * Cleanup sessions-index files - remove bloat
   */
  cleanup() {
    const projectsDir = path.join(MEMEX_PATH, 'summaries/projects');
    const results = [];

    if (!fs.existsSync(projectsDir)) {
      return { error: 'Projects directory not found' };
    }

    for (const projName of fs.readdirSync(projectsDir)) {
      const sessionsIndexPath = path.join(projectsDir, projName, 'sessions-index.json');
      if (!fs.existsSync(sessionsIndexPath)) continue;

      try {
        const original = fs.readFileSync(sessionsIndexPath, 'utf8');
        const data = JSON.parse(original);
        const originalSize = original.length;

        // Slim down sessions - remove empty/redundant fields
        if (data.sessions) {
          data.sessions = data.sessions.map(s => {
            const slim = {
              id: s.id,
              date: s.date,
              summary: s.summary,
              topics: s.topics || []
            };

            // Only keep non-empty arrays
            if (s.key_decisions?.length > 0) slim.key_decisions = s.key_decisions;
            if (s.outcomes?.completed?.length > 0) slim.outcomes = s.outcomes;
            if (s.learnings?.length > 0) slim.learnings = s.learnings;

            // Simplify code_changes to just counts if present
            if (s.code_changes) {
              const cc = s.code_changes;
              if (cc.lines_added > 0 || cc.lines_removed > 0) {
                slim.changes = `+${cc.lines_added}/-${cc.lines_removed}`;
              }
            }

            return slim;
          });
        }

        // Remove redundant topics_index (can be rebuilt from sessions)
        delete data.topics_index;

        // Remove schema reference (not needed at runtime)
        delete data.$schema;

        const newContent = JSON.stringify(data, null, 2);
        const newSize = newContent.length;
        const savings = originalSize - newSize;
        const savingsPercent = Math.round((savings / originalSize) * 100);

        if (savings > 0) {
          // Backup original
          fs.writeFileSync(sessionsIndexPath + '.backup', original);
          // Write slimmed version
          fs.writeFileSync(sessionsIndexPath, newContent);
        }

        results.push({
          project: projName,
          original: `${Math.round(originalSize / 1024)}KB`,
          new: `${Math.round(newSize / 1024)}KB`,
          saved: `${Math.round(savings / 1024)}KB (${savingsPercent}%)`
        });

      } catch (e) {
        results.push({
          project: projName,
          error: e.message
        });
      }
    }

    return results;
  }

  /**
   * Consolidate single-use topics in main index
   */
  consolidateTopics() {
    const index = JSON.parse(fs.readFileSync(this.indexPath, 'utf8'));
    const originalTopicCount = Object.keys(index.t).length;

    // Group single-session topics by category
    const consolidationMap = {
      'pr-': 'pr-reviews',
      'issue-': 'issues',
      'epic-': 'epics'
    };

    const newTopics = {};
    const consolidated = { count: 0, topics: [] };

    for (const [topic, data] of Object.entries(index.t)) {
      // Skip empty topic
      if (topic === '') continue;

      // Check if should consolidate
      let shouldConsolidate = false;
      let targetTopic = null;

      for (const [prefix, target] of Object.entries(consolidationMap)) {
        if (topic.startsWith(prefix) && data.sc <= 1) {
          shouldConsolidate = true;
          targetTopic = target;
          break;
        }
      }

      if (shouldConsolidate) {
        if (!newTopics[targetTopic]) {
          newTopics[targetTopic] = { p: new Set(), sc: 0 };
        }
        data.p.forEach(p => newTopics[targetTopic].p.add(p));
        newTopics[targetTopic].sc += data.sc;
        consolidated.count++;
        consolidated.topics.push(topic);
      } else if (data.sc > 0) {
        // Keep topics with sessions
        newTopics[topic] = data;
      }
    }

    // Convert Sets back to arrays
    for (const [topic, data] of Object.entries(newTopics)) {
      if (data.p instanceof Set) {
        newTopics[topic].p = Array.from(data.p);
      }
    }

    // Update index
    index.t = newTopics;

    const newTopicCount = Object.keys(index.t).length;

    // Backup and save
    fs.writeFileSync(this.indexPath + '.backup', JSON.stringify(JSON.parse(fs.readFileSync(this.indexPath, 'utf8')), null, 2));
    fs.writeFileSync(this.indexPath, JSON.stringify(index, null, 2));

    return {
      original_topics: originalTopicCount,
      new_topics: newTopicCount,
      consolidated: consolidated.count,
      removed: consolidated.topics
    };
  }
}

// CLI
const command = process.argv[2];
const slim = new SlimContext();

switch (command) {
  case 'generate':
    console.log('Generating slim context...');
    const genResult = slim.generate();
    console.log(`✅ Created ${genResult.output}`);
    console.log(`   Size: ${genResult.size_compact} bytes (${Math.round(genResult.size_compact/1024)}KB)`);
    console.log(`   Projects: ${genResult.projects}`);
    console.log(`   Recent sessions: ${genResult.recent_sessions}`);
    break;

  case 'show':
    const context = slim.show();
    if (context) {
      console.log(JSON.stringify(context, null, 2));
    }
    break;

  case 'cleanup':
    console.log('Cleaning up sessions-index files...');
    const cleanupResults = slim.cleanup();
    console.table(cleanupResults);
    break;

  case 'consolidate':
    console.log('Consolidating topics in index...');
    const consResult = slim.consolidateTopics();
    console.log(`✅ Consolidated ${consResult.consolidated} topics`);
    console.log(`   Before: ${consResult.original_topics} topics`);
    console.log(`   After: ${consResult.new_topics} topics`);
    if (consResult.removed.length > 0) {
      console.log(`   Removed: ${consResult.removed.slice(0, 10).join(', ')}${consResult.removed.length > 10 ? '...' : ''}`);
    }
    break;

  default:
    console.log(`
Slim Context Generator v1.0

Usage:
  node slim-context.js generate     Create ultra-slim context (~2KB)
  node slim-context.js show         Display current slim context
  node slim-context.js cleanup      Remove bloat from sessions-index files
  node slim-context.js consolidate  Consolidate single-use topics

This creates a minimal context file that gives Claude:
- Quick refs (commit format, PR requirements, branching)
- Project basics (name, tech, sessions count)
- Recent 3 sessions per project (date, summary, topics)

Target size: <2KB (vs 15KB full index)
Token savings: ~90% on startup context
`);
}
