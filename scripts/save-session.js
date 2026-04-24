#!/usr/bin/env node
/* eslint-disable */

/**
 * Save Session - Save AI assistant session to Codicil
 *
 * Usage:
 *   save-session "Implemented OAuth2 authentication" --topics auth,oauth,google
 *   save-session "Summary" --topics auth --commit        (also git commit)
 *   save-session "Summary" --topics auth --commit --push (commit + push)
 *   save-session --interactive                           (prompts for everything)
 */

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const readline = require('readline');
const { resolveCodicilPath, resolveProjectDirName, normalizeProjectSlug } = require('./paths');
const agentbridge = require('./agentbridge-client');
const { readJSON } = require('./safe-json');

const CODICIL_PATH = resolveCodicilPath(__dirname);
const LOCK_TTL_MS = 30 * 1000;

// ─────────────────────────────────────────────────────────────
// TF-IDF Topic Extraction (#10)
// ─────────────────────────────────────────────────────────────

const STOPWORDS = new Set([
  'a','an','the','and','or','but','in','on','at','to','for','of','with',
  'by','from','as','is','was','are','were','be','been','being','have','has',
  'had','do','does','did','will','would','could','should','may','might','shall',
  'can','need','dare','used','i','we','you','he','she','they','it','this',
  'that','these','those','my','your','our','their','its','what','which','who',
  'when','where','why','how','all','any','both','each','few','more','most',
  'other','some','such','no','not','only','own','same','so','than','too',
  'very','just','because','if','then','into','up','out','about','after',
  'before','between','through','during','above','below','again','further',
  'once','also','new','added','updated','changed','fixed','removed','refactored',
  'over','under','across','within','without','along','against','among','around',
  'down','off','per','upon','via','versus','vs','etc','get','got','set','let',

]);

/**
 * Extract topics from text using TF-IDF-inspired scoring.
 * Returns top N tokens by score (term frequency weighted by length and rarity).
 */
function extractTopics(text, { topN = 5, minLen = 3 } = {}) {
  if (!text || !text.trim()) return [];

  // Tokenize: split on non-alphanumeric, lowercase, deduplicate camelCase
  const raw = text
    .replace(/([a-z])([A-Z])/g, '$1 $2')  // camelCase → two words
    .replace(/[^a-zA-Z0-9\s]/g, ' ')
    .toLowerCase()
    .split(/\s+/)
    .filter(t => t.length >= minLen && !STOPWORDS.has(t) && !/^\d+$/.test(t));

  if (!raw.length) return [];

  // Term frequency
  const tf = {};
  for (const token of raw) {
    tf[token] = (tf[token] || 0) + 1;
  }

  // Score: TF × log(length) — longer words tend to be more specific
  const scored = Object.entries(tf).map(([term, freq]) => ({
    term,
    score: freq * Math.log(term.length + 1),
  }));

  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, topN).map(s => s.term);
}

function atomicWriteFileSync(targetPath, content) {
  const dir = path.dirname(targetPath);
  fs.mkdirSync(dir, { recursive: true });
  const tmpPath = path.join(dir, `.tmp-${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}-${path.basename(targetPath)}`);
  const fd = fs.openSync(tmpPath, 'wx');
  try {
    fs.writeFileSync(fd, content);
    fs.fsyncSync(fd);
  } finally {
    fs.closeSync(fd);
  }
  fs.renameSync(tmpPath, targetPath);
}

function lockFilePath(targetPath) {
  return `${targetPath}.lock`;
}

async function withFileLock(targetPath, fn, { retries = 20, delayMs = 25 } = {}) {
  const dir = path.dirname(targetPath);
  fs.mkdirSync(dir, { recursive: true });
  const lockPath = lockFilePath(targetPath);
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const fd = fs.openSync(lockPath, 'wx');
      try {
        const payload = JSON.stringify({ pid: process.pid, started_at: Date.now() });
        fs.writeFileSync(fd, payload);
        fs.fsyncSync(fd);
        return await fn();
      } finally {
        fs.closeSync(fd);
        try {
          fs.unlinkSync(lockPath);
        } catch (e) {
          // Best effort cleanup
        }
      }
    } catch (e) {
      if (e.code !== 'EEXIST') throw e;
      try {
        const stat = fs.statSync(lockPath);
        const ageMs = Date.now() - stat.mtimeMs;
        if (ageMs > LOCK_TTL_MS) {
          fs.unlinkSync(lockPath);
          continue;
        }
      } catch (err) {
        if (err.code !== 'ENOENT') {
          // ignore and fall through to retry
        }
      }
      if (attempt === retries) throw new Error(`Lock timeout for ${path.basename(targetPath)}`);
      await new Promise(resolve => setTimeout(resolve, delayMs));
    }
  }
}

class SessionSaver {
  constructor(options = {}) {
    this.codicil = require('./codicil-loader');
    this.loader = new this.codicil();
    this.loader.loadIndex();
    if (options.project) {
    this.currentProject = options.project;
    } else {
      const detection = this.loader.detectProject();
      this.currentProject = detection.project;

      if (!this.currentProject) {
        throw new Error('Could not detect current project from git remote, package.json, or directory.');
      }
    }

    // AgentBridge: async init, stored as promise (never blocks constructor)
    this._bridge = agentbridge.connect();
  }

  /**
   * Generate session ID
   */
  generateSessionId(topics) {
    const now = new Date();
    const date = now.toISOString().split('T')[0];
    const time = now.toISOString().slice(11, 16).replace(':', '');
    const projectPrefix = this.currentProject.substring(0, 2).toLowerCase();
    const topicSlug = (topics[0] || 'session')
      .toLowerCase()
      .replace(/[^a-z0-9-_]/g, '')
      .slice(0, 24) || 'session';
    const nonce = Math.random().toString(36).slice(2, 6);
    return `${projectPrefix}-${date}-${time}-${topicSlug}-${nonce}`;
  }

  /**
   * Get git changes for this session
   */
  getGitChanges() {
    try {
      const status = execFileSync('git', ['status', '--short'], { encoding: 'utf8' });
      const diff = execFileSync('git', ['diff', '--stat'], { encoding: 'utf8' });

      const files = {
        added: [],
        modified: [],
        deleted: []
      };

      status.split('\n').forEach(line => {
        if (!line) return;
        const status = line.substring(0, 2);
        const file = line.substring(3);

        if (status.includes('A')) files.added.push(file);
        else if (status.includes('M')) files.modified.push(file);
        else if (status.includes('D')) files.deleted.push(file);
      });

      // Parse diff stats
      const statsMatch = diff.match(/(\d+) files? changed(?:, (\d+) insertions?\(\+\))?(?:, (\d+) deletions?\(-\))?/);
      const stats = {
        files_changed: parseInt(statsMatch?.[1] || 0),
        lines_added: parseInt(statsMatch?.[2] || 0),
        lines_removed: parseInt(statsMatch?.[3] || 0)
      };

      return { files, stats };
    } catch (e) {
      return null;
    }
  }

  /**
   * Save session
   */
  async saveSession(summary, topics, fullContent = null, options = {}) {
    const sessionId = this.generateSessionId(topics);
    const date = new Date().toISOString().split('T')[0];
    const yearMonth = date.substring(0, 7); // YYYY-MM
    let gitChanges = null;

    // Create session metadata
    const session = {
      id: sessionId,
      project: this.currentProject,
      project_display: this.currentProject,
      project_slug: normalizeProjectSlug(this.currentProject),
      date,
      summary,
      topics,
      key_decisions: Array.isArray(options.key_decisions) ? options.key_decisions : [],
      outcomes: {
        completed: []
      },
      learnings: Array.isArray(options.learnings) ? options.learnings : []
    };

    // Add git changes if available
    if (options.include_git_changes !== false) {
      gitChanges = this.getGitChanges();
      if (gitChanges) {
        session.code_changes = {
          files_added: gitChanges.files.added,
          files_modified: gitChanges.files.modified,
          files_deleted: gitChanges.files.deleted,
          lines_added: gitChanges.stats.lines_added,
          lines_removed: gitChanges.stats.lines_removed
        };
      }
    }

    // Update sessions index
    const projectDirName = resolveProjectDirName(CODICIL_PATH, this.currentProject);
    const indexPath = path.join(CODICIL_PATH, 'summaries/projects', projectDirName, 'sessions-index.json');

    await withFileLock(indexPath, async () => {
      let sessionsIndex = readJSON(indexPath);
      if (sessionsIndex) {
        // Ensure topics_index exists (backward compatibility)
        if (!sessionsIndex.topics_index) {
          sessionsIndex.topics_index = {};
        }
      } else {
      sessionsIndex = {
        project: this.currentProject,
        project_display: this.currentProject,
        project_slug: normalizeProjectSlug(this.currentProject),
        total_sessions: 0,
        last_updated: date,
        sessions: [],
          topics_index: {}
        };
      }

      // Add session
      sessionsIndex.sessions.unshift(session);
      sessionsIndex.total_sessions++;
      sessionsIndex.last_updated = date;

      // Update topics index
      topics.forEach(topic => {
        if (!sessionsIndex.topics_index[topic]) {
          sessionsIndex.topics_index[topic] = [];
        }
        sessionsIndex.topics_index[topic].push(sessionId);
      });

      // Save sessions index
      fs.mkdirSync(path.dirname(indexPath), { recursive: true });
      atomicWriteFileSync(indexPath, JSON.stringify(sessionsIndex, null, 2));
    });

    // Save full content if provided
    if (fullContent) {
      const contentPath = path.join(
        CODICIL_PATH,
        'content/projects',
        projectDirName,
        'sessions',
        yearMonth,
        `${sessionId}.md`
      );

      fs.mkdirSync(path.dirname(contentPath), { recursive: true });
      atomicWriteFileSync(contentPath, fullContent);
    }

    // Update main index
    await this.updateMainIndex();

    // Notify AgentBridge (fire-and-forget, never blocks)
    if (this._bridge) {
      this._bridge
        .then(bridge => bridge.emit('codicil.session.saved', {
          session_id: sessionId,
          project: this.currentProject,
          summary,
          topics,
          timestamp: new Date().toISOString(),
          git_stats: gitChanges?.stats || null,
        }))
        .catch(() => {});
    }

    // Commit to git only if explicitly requested
    if (options.commit) {
      this.commitToGit(sessionId, { push: options.push === true });
    }

    return {
      session_id: sessionId,
      project: this.currentProject,
      saved: true,
      session
    };
  }

  /**
   * Update main Codicil index (v2.0 with abbreviated keys)
   */
  async updateMainIndex() {
    const indexPath = path.join(CODICIL_PATH, 'index.json');
    await withFileLock(indexPath, async () => {
      const index = readJSON(indexPath);
      if (!index) return;

      // Update project session count
    const projectDirName = resolveProjectDirName(CODICIL_PATH, this.currentProject);
    const sessionsIndexPath = path.join(
      CODICIL_PATH,
      'summaries/projects',
      projectDirName,
      'sessions-index.json'
    );

      const sessionsIndex = readJSON(sessionsIndexPath);
      if (sessionsIndex) {
        // v2.0 uses abbreviated keys: p=projects, sc=session_count, u=last_updated
        if (index.p && index.p[this.currentProject]) {
          index.p[this.currentProject].sc = sessionsIndex.total_sessions;
          index.p[this.currentProject].u = new Date().toISOString().split('T')[0];
        }

        // Update topics index - v2.0 uses: t=topics, p=projects, sc=session_count
        if (index.t && sessionsIndex.topics_index) {
          Object.entries(sessionsIndex.topics_index).forEach(([topic, sessionIds]) => {
            if (!index.t[topic]) {
              index.t[topic] = { p: [], sc: 0 };
            }
            // Add project if not already there
            if (!index.t[topic].p.includes(this.currentProject)) {
              index.t[topic].p.push(this.currentProject);
            }
            // Update session count for this topic
            index.t[topic].sc = sessionIds.length;
          });
        }
      }

      // Update metadata - v2.0 uses: u=last_updated, m=metadata, ts=total_sessions
      index.u = new Date().toISOString();
      index.m.ts = Object.values(index.p)
        .reduce((sum, p) => sum + (p.sc || 0), 0);

      atomicWriteFileSync(indexPath, JSON.stringify(index, null, 2));
    });
  }

  /**
   * Commit changes to git
   */
  commitToGit(sessionId, options = {}) {
    const { push = false } = options;
    try {
      const pathsToAdd = ['index.json'];
      const projectSummariesPath = path.join('summaries', 'projects', this.currentProject);
      if (fs.existsSync(path.join(CODICIL_PATH, projectSummariesPath))) {
        pathsToAdd.push(projectSummariesPath);
      }
      const projectContentPath = path.join('content', 'projects', this.currentProject);
      if (fs.existsSync(path.join(CODICIL_PATH, projectContentPath))) {
        pathsToAdd.push(projectContentPath);
      }

      execFileSync('git', ['add', ...pathsToAdd], { cwd: CODICIL_PATH });
      execFileSync('git', ['commit', '-m', `chore(codicil): add session ${sessionId}`], { cwd: CODICIL_PATH });
      console.log('✓ Changes committed to Codicil');

      if (push) {
        execFileSync('git', ['push', 'origin', 'main'], { cwd: CODICIL_PATH, stdio: 'inherit' });
        console.log('✓ Pushed to remote');
      }
    } catch (e) {
      console.warn('⚠ Could not commit to git:', e.message);
    }
  }

  /**
   * Interactive mode
   */
  async interactive() {
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout
    });

    const question = (query) => new Promise(resolve => rl.question(query, resolve));

    console.log(`\n📝 Remember - Save session for ${this.currentProject}\n`);

    const summary = await question('Summary (1-2 sentences): ');
    const topicsInput = await question('Topics (comma-separated, e.g., auth,oauth,google): ');
    const topics = topicsInput.split(',').map(t => t.trim()).filter(Boolean);

    const hasContent = await question('\nDo you want to add detailed notes? (y/N): ');
    let fullContent = null;

    if (hasContent.toLowerCase() === 'y') {
      console.log('\nEnter detailed notes (Ctrl+D when done):\n');
      fullContent = await new Promise(resolve => {
        let content = '';
        process.stdin.setEncoding('utf8');
        process.stdin.on('data', chunk => content += chunk);
        process.stdin.on('end', () => resolve(content));
      });
    }

    rl.close();

    console.log('\n💾 Saving session...\n');
    const result = await this.saveSession(summary, topics, fullContent);

    console.log(`✅ Session saved: ${result.session_id}\n`);
  }
}

// CLI
if (require.main === module) {
  const args = process.argv.slice(2);

  (async () => {
    try {
      const saver = new SessionSaver();

      if (args.includes('--interactive') || args.length === 0) {
        await saver.interactive();
      } else {
        const autoSummarize = args.includes('--auto-summarize');
        const topicsIndex = args.indexOf('--topics');
        const commit = args.includes('--commit');
        const push = args.includes('--push');

        let summary = args[0];
        let topics = topicsIndex > -1 && args[topicsIndex + 1]
          ? args[topicsIndex + 1].split(',').map(t => t.trim())
          : [];

        if (autoSummarize) {
          // Read content from stdin or from --content flag
          const contentIdx = args.indexOf('--content');
          let content = contentIdx > -1 ? args[contentIdx + 1] : '';

          if (!content && !process.stdin.isTTY) {
            content = await new Promise(resolve => {
              let buf = '';
              process.stdin.setEncoding('utf8');
              process.stdin.on('data', c => buf += c);
              process.stdin.on('end', () => resolve(buf));
            });
          }

          if (content) {
            const Summarizer = require('./summarizer');
            const s = new Summarizer();
            const result = await s.summarize({ content, topics, project: saver.currentProject });
            if (result.summary) {
              summary = result.summary;
              console.log(`🤖 Summary (${result.provider}): ${summary}`);
            }
            // Auto-extract topics from content when none provided
            if (!topics.length) {
              topics = extractTopics(content + ' ' + (summary || ''));
            }
          }
        } else if (!topics.length && summary) {
          // Auto-extract topics from summary text
          topics = extractTopics(summary);
        }

        const result = await saver.saveSession(summary, topics, null, { commit, push });
        console.log(`✅ Session saved: ${result.session_id}`);
        if (topics.length) console.log(`   Topics: ${topics.join(', ')}`);
      }
    } catch (error) {
      console.error('❌ Error:', error.message);
      process.exit(1);
    }
  })();
}

module.exports = SessionSaver;
module.exports.extractTopics = extractTopics;
