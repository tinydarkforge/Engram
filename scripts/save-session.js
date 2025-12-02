#!/usr/bin/env node

/**
 * Recuerda - Save Claude session to Memex
 *
 * Usage:
 *   recuerda "Implemented OAuth2 authentication" --topics auth,oauth,google
 *   recuerda --interactive  (prompts for summary and topics)
 */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const readline = require('readline');

const MEMEX_PATH = process.env.MEMEX_PATH || path.join(process.env.HOME, 'code/cirrus/DevOps/Memex');

class Recuerda {
  constructor() {
    this.memex = require('./memex-loader');
    this.loader = new this.memex();
    this.loader.loadIndex();
    const detection = this.loader.detectProject();
    this.currentProject = detection.project;

    if (!this.currentProject) {
      throw new Error('Could not detect current project. Are you in a Cirrus repository?');
    }
  }

  /**
   * Generate session ID
   */
  generateSessionId(topics) {
    const date = new Date().toISOString().split('T')[0];
    const projectPrefix = this.currentProject.substring(0, 2).toLowerCase();
    const topicSlug = topics[0] || 'session';
    return `${projectPrefix}-${date}-${topicSlug}`;
  }

  /**
   * Get git changes for this session
   */
  getGitChanges() {
    try {
      const status = execSync('git status --short', { encoding: 'utf8' });
      const diff = execSync('git diff --stat', { encoding: 'utf8' });

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
  async saveSession(summary, topics, fullContent = null) {
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

    let sessionsIndex;
    if (fs.existsSync(indexPath)) {
      sessionsIndex = JSON.parse(fs.readFileSync(indexPath, 'utf8'));
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

    // Commit to git
    this.commitToGit(sessionId);

    return {
      session_id: sessionId,
      project: this.currentProject,
      saved: true
    };
  }

  /**
   * Update main Memex index
   */
  updateMainIndex() {
    const indexPath = path.join(MEMEX_PATH, 'index.json');
    const index = JSON.parse(fs.readFileSync(indexPath, 'utf8'));

    // Update project session count
    const sessionsIndexPath = path.join(
      MEMEX_PATH,
      'summaries/projects',
      this.currentProject,
      'sessions-index.json'
    );

    if (fs.existsSync(sessionsIndexPath)) {
      const sessionsIndex = JSON.parse(fs.readFileSync(sessionsIndexPath, 'utf8'));
      if (index.projects[this.currentProject]) {
        index.projects[this.currentProject].session_count = sessionsIndex.total_sessions;
        index.projects[this.currentProject].last_updated = new Date().toISOString().split('T')[0];
      }
    }

    // Update metadata
    index.last_updated = new Date().toISOString();
    index.metadata.total_sessions = Object.values(index.projects)
      .reduce((sum, p) => sum + (p.session_count || 0), 0);

    fs.writeFileSync(indexPath, JSON.stringify(index, null, 2));
  }

  /**
   * Commit changes to git
   */
  commitToGit(sessionId) {
    try {
      execSync('git add .', { cwd: MEMEX_PATH });
      execSync(
        `git commit -m "chore(memex): add session ${sessionId}" || true`,
        { cwd: MEMEX_PATH }
      );
      console.log('✓ Changes committed to Memex');

      // Push in background (don't wait)
      execSync('git push origin main &', { cwd: MEMEX_PATH, stdio: 'ignore' });
      console.log('✓ Pushing to remote (background)...');
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

    console.log(`\n📝 Recuerda - Save session for ${this.currentProject}\n`);

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
    const recuerda = new Recuerda();

    if (args.includes('--interactive') || args.length === 0) {
      recuerda.interactive();
    } else {
      const summary = args[0];
      const topicsIndex = args.indexOf('--topics');
      const topics = topicsIndex > -1
        ? args[topicsIndex + 1].split(',').map(t => t.trim())
        : [];

      recuerda.saveSession(summary, topics).then(result => {
        console.log(`✅ Session saved: ${result.session_id}`);
      });
    }
  } catch (error) {
    console.error('❌ Error:', error.message);
    process.exit(1);
  }
}

module.exports = Recuerda;
