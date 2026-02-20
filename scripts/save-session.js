#!/usr/bin/env node

/**
 * Save Session - Save AI assistant session to Memex
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
const { resolveMemexPath } = require('./paths');
const agentbridge = require('./agentbridge-client');
const { readJSON } = require('./safe-json');

const MEMEX_PATH = resolveMemexPath(__dirname);

class SessionSaver {
  constructor() {
    this.memex = require('./memex-loader');
    this.loader = new this.memex();
    this.loader.loadIndex();
    const detection = this.loader.detectProject();
    this.currentProject = detection.project;

    if (!this.currentProject) {
      throw new Error('Could not detect current project from git remote, package.json, or directory.');
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

    // Create session metadata
    const session = {
      id: sessionId,
      project: this.currentProject,
      date,
      summary,
      topics,
      key_decisions: [],
      outcomes: {
        completed: []
      },
      learnings: []
    };

    // Add git changes if available
    const gitChanges = this.getGitChanges();
    if (gitChanges) {
      session.code_changes = {
        files_added: gitChanges.files.added,
        files_modified: gitChanges.files.modified,
        files_deleted: gitChanges.files.deleted,
        lines_added: gitChanges.stats.lines_added,
        lines_removed: gitChanges.stats.lines_removed
      };
    }

    // Update sessions index
    const indexPath = path.join(
      MEMEX_PATH,
      'summaries/projects',
      this.currentProject,
      'sessions-index.json'
    );

    let sessionsIndex = readJSON(indexPath);
    if (sessionsIndex) {
      // Ensure topics_index exists (backward compatibility)
      if (!sessionsIndex.topics_index) {
        sessionsIndex.topics_index = {};
      }
    } else {
      sessionsIndex = {
        project: this.currentProject,
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
    fs.writeFileSync(indexPath, JSON.stringify(sessionsIndex, null, 2));

    // Save full content if provided
    if (fullContent) {
      const contentPath = path.join(
        MEMEX_PATH,
        'content/projects',
        this.currentProject,
        'sessions',
        yearMonth,
        `${sessionId}.md`
      );

      fs.mkdirSync(path.dirname(contentPath), { recursive: true });
      fs.writeFileSync(contentPath, fullContent);
    }

    // Update main index
    this.updateMainIndex();

    // Notify AgentBridge (fire-and-forget, never blocks)
    if (this._bridge) {
      this._bridge
        .then(bridge => bridge.emit('memex.session.saved', {
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
      saved: true
    };
  }

  /**
   * Update main Memex index (v2.0 with abbreviated keys)
   */
  updateMainIndex() {
    const indexPath = path.join(MEMEX_PATH, 'index.json');
    const index = readJSON(indexPath);
    if (!index) return;

    // Update project session count
    const sessionsIndexPath = path.join(
      MEMEX_PATH,
      'summaries/projects',
      this.currentProject,
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

    fs.writeFileSync(indexPath, JSON.stringify(index, null, 2));
  }

  /**
   * Commit changes to git
   */
  commitToGit(sessionId, options = {}) {
    const { push = false } = options;
    try {
      const pathsToAdd = ['index.json'];
      const projectSummariesPath = path.join('summaries', 'projects', this.currentProject);
      if (fs.existsSync(path.join(MEMEX_PATH, projectSummariesPath))) {
        pathsToAdd.push(projectSummariesPath);
      }
      const projectContentPath = path.join('content', 'projects', this.currentProject);
      if (fs.existsSync(path.join(MEMEX_PATH, projectContentPath))) {
        pathsToAdd.push(projectContentPath);
      }

      execFileSync('git', ['add', ...pathsToAdd], { cwd: MEMEX_PATH });
      execFileSync('git', ['commit', '-m', `chore(memex): add session ${sessionId}`], { cwd: MEMEX_PATH });
      console.log('✓ Changes committed to Memex');

      if (push) {
        execFileSync('git', ['push', 'origin', 'main'], { cwd: MEMEX_PATH, stdio: 'inherit' });
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

  try {
    const saver = new SessionSaver();

    if (args.includes('--interactive') || args.length === 0) {
      saver.interactive();
    } else {
      const summary = args[0];
      const topicsIndex = args.indexOf('--topics');
      const topics = topicsIndex > -1 && args[topicsIndex + 1]
        ? args[topicsIndex + 1].split(',').map(t => t.trim())
        : [];
      const commit = args.includes('--commit');
      const push = args.includes('--push');

      saver.saveSession(summary, topics, null, { commit, push }).then(result => {
        console.log(`✅ Session saved: ${result.session_id}`);
      });
    }
  } catch (error) {
    console.error('❌ Error:', error.message);
    process.exit(1);
  }
}

module.exports = SessionSaver;
