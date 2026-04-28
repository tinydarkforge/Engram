#!/usr/bin/env node

const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { execSync } = require('child_process');

// Clear module cache
Object.keys(require.cache)
  .filter(k => k.includes('index-git') || k.includes('paths'))
  .forEach(k => delete require.cache[k]);

const GitIndexer = require('../scripts/index-git');

describe('GitIndexer', () => {
  const indexer = new GitIndexer();

  describe('parseConventionalCommit()', () => {
    it('parses type(scope): description', () => {
      const result = indexer.parseConventionalCommit('feat(auth): add OAuth support');
      assert.equal(result.type, 'feat');
      assert.equal(result.scope, 'auth');
      assert.equal(result.description, 'add OAuth support');
    });

    it('parses type: description without scope', () => {
      const result = indexer.parseConventionalCommit('fix: resolve null pointer');
      assert.equal(result.type, 'fix');
      assert.equal(result.scope, null);
      assert.equal(result.description, 'resolve null pointer');
    });

    it('handles non-conventional commits', () => {
      const result = indexer.parseConventionalCommit('Update README');
      assert.equal(result.type, null);
      assert.equal(result.scope, null);
      assert.equal(result.description, 'Update README');
    });

    it('parses all standard types', () => {
      const types = ['feat', 'fix', 'docs', 'style', 'refactor', 'test', 'chore', 'perf'];
      for (const type of types) {
        const result = indexer.parseConventionalCommit(`${type}: something`);
        assert.equal(result.type, type);
      }
    });

    it('handles complex scope names', () => {
      const result = indexer.parseConventionalCommit('fix(api-gateway): handle timeout');
      assert.equal(result.type, 'fix');
      assert.equal(result.scope, 'api-gateway');
      assert.equal(result.description, 'handle timeout');
    });
  });

  describe('buildEmbeddingText()', () => {
    it('includes project name and subject', () => {
      const text = indexer.buildEmbeddingText(
        { subject: 'add login', body: '', files: [] },
        'MyProject'
      );
      assert.ok(text.includes('[MyProject]'));
      assert.ok(text.includes('add login'));
    });

    it('includes body when present', () => {
      const text = indexer.buildEmbeddingText(
        { subject: 'fix bug', body: 'This fixes the null check', files: [] },
        'Proj'
      );
      assert.ok(text.includes('This fixes the null check'));
    });

    it('includes files when present', () => {
      const text = indexer.buildEmbeddingText(
        { subject: 'update', body: '', files: ['src/auth.js', 'src/login.js'] },
        'Proj'
      );
      assert.ok(text.includes('Files:'));
      assert.ok(text.includes('src/auth.js'));
    });

    it('caps body length at 200 chars', () => {
      const longBody = 'x'.repeat(500);
      const text = indexer.buildEmbeddingText(
        { subject: 'test', body: longBody, files: [] },
        'P'
      );
      // Should not contain full 500 chars
      assert.ok(text.length < 250);
    });
  });

  describe('cosineSimilarity()', () => {
    it('returns 1 for identical vectors', () => {
      const v = [1, 2, 3];
      const sim = indexer.cosineSimilarity(v, v);
      assert.ok(Math.abs(sim - 1) < 0.0001);
    });

    it('returns 0 for orthogonal vectors', () => {
      const sim = indexer.cosineSimilarity([1, 0], [0, 1]);
      assert.ok(Math.abs(sim) < 0.0001);
    });

    it('returns -1 for opposite vectors', () => {
      const sim = indexer.cosineSimilarity([1, 0], [-1, 0]);
      assert.ok(Math.abs(sim + 1) < 0.0001);
    });
  });

  describe('extractCommits()', () => {
    let tmpRepo;

    before(() => {
      tmpRepo = fs.mkdtempSync(path.join(os.tmpdir(), 'engram-git-test-'));
      // Initialize a git repo with a commit
      execSync('git init', { cwd: tmpRepo });
      execSync('git config user.email "test@test.com"', { cwd: tmpRepo });
      execSync('git config user.name "Test"', { cwd: tmpRepo });
      fs.writeFileSync(path.join(tmpRepo, 'file.txt'), 'hello');
      execSync('git add .', { cwd: tmpRepo });
      execSync('git commit -m "feat(core): initial commit"', { cwd: tmpRepo });
      // Add a second commit so diff-tree has a parent to compare against
      fs.writeFileSync(path.join(tmpRepo, 'file.txt'), 'updated');
      execSync('git add .', { cwd: tmpRepo });
      execSync('git commit -m "fix(core): update file"', { cwd: tmpRepo });
    });

    after(() => {
      fs.rmSync(tmpRepo, { recursive: true, force: true });
    });

    it('extracts commits from a git repo', () => {
      const commits = indexer.extractCommits(tmpRepo, '1 year ago');
      assert.ok(commits.length >= 2);
      // Most recent commit first
      assert.equal(commits[0].subject, 'fix(core): update file');
      assert.equal(commits[0].type, 'fix');
      assert.equal(commits[0].scope, 'core');
      assert.ok(commits[0].hash.length === 8);
      assert.ok(commits[0].fullHash.length === 40);
    });

    it('returns empty array for non-existent path', () => {
      const commits = indexer.extractCommits('/nonexistent/path');
      assert.deepEqual(commits, []);
    });

    it('returns empty array for non-git directory', () => {
      const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'no-git-'));
      const commits = indexer.extractCommits(tmpDir);
      assert.deepEqual(commits, []);
      fs.rmSync(tmpDir, { recursive: true, force: true });
    });

    it('includes changed files for non-initial commits', () => {
      const commits = indexer.extractCommits(tmpRepo, '1 year ago');
      // The second commit (index 0, most recent) modifies file.txt
      assert.ok(commits[0].files.length > 0);
      assert.ok(commits[0].files.includes('file.txt'));
    });

    it('includes date in YYYY-MM-DD format', () => {
      const commits = indexer.extractCommits(tmpRepo, '1 year ago');
      assert.match(commits[0].date, /^\d{4}-\d{2}-\d{2}$/);
    });
  });

  describe('getStats()', () => {
    it('returns error when no index exists', () => {
      const fresh = new GitIndexer();
      const stats = fresh.getStats();
      assert.ok(stats.error);
    });
  });
});
