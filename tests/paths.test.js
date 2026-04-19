#!/usr/bin/env node

const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const fs = require('fs');
const os = require('os');

describe('paths', () => {
  let originalMemexPath;
  let originalReposRoot;
  let resolveMemexPath;
  let resolveReposRoot;
  let resolveProjectDirName;
  let normalizeProjectSlug;
  let tmpDir;

  before(() => {
    originalMemexPath = process.env.MEMEX_PATH;
    originalReposRoot = process.env.MEMEX_REPOS_ROOT;

    // Clear module cache
    Object.keys(require.cache)
      .filter(k => k.includes('paths'))
      .forEach(k => delete require.cache[k]);

    ({ resolveMemexPath, resolveReposRoot, resolveProjectDirName, normalizeProjectSlug } = require('../scripts/paths'));
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'memex-paths-'));
    fs.mkdirSync(path.join(tmpDir, 'summaries', 'projects'), { recursive: true });
  });

  after(() => {
    if (originalMemexPath !== undefined) {
      process.env.MEMEX_PATH = originalMemexPath;
    } else {
      delete process.env.MEMEX_PATH;
    }
    if (originalReposRoot !== undefined) {
      process.env.MEMEX_REPOS_ROOT = originalReposRoot;
    } else {
      delete process.env.MEMEX_REPOS_ROOT;
    }
    if (tmpDir) {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  describe('resolveMemexPath()', () => {
    it('uses MEMEX_PATH env var when set', () => {
      process.env.MEMEX_PATH = '/custom/memex';
      const result = resolveMemexPath('/some/dir');
      assert.equal(result, path.resolve('/custom/memex'));
    });

    it('defaults to parent of fromDir', () => {
      delete process.env.MEMEX_PATH;
      const result = resolveMemexPath('/a/b/scripts');
      assert.equal(result, path.resolve('/a/b'));
    });

    it('defaults to parent of __dirname when no arg', () => {
      delete process.env.MEMEX_PATH;
      const result = resolveMemexPath();
      // Should resolve relative to current working directory's parent
      assert.ok(path.isAbsolute(result));
    });
  });

  describe('resolveReposRoot()', () => {
    it('uses MEMEX_REPOS_ROOT env var when set', () => {
      process.env.MEMEX_REPOS_ROOT = '/custom/repos';
      const result = resolveReposRoot('/some/memex');
      assert.equal(result, path.resolve('/custom/repos'));
    });

    it('defaults to parent of memexPath', () => {
      delete process.env.MEMEX_REPOS_ROOT;
      const result = resolveReposRoot('/code/org/Memex');
      assert.equal(result, path.resolve('/code/org'));
    });
  });

  describe('project slug utilities', () => {
    it('normalizeProjectSlug() lowercases and replaces invalid chars', () => {
      const result = normalizeProjectSlug('My Project! 2026');
      assert.equal(result, 'my-project-2026');
    });

    it('resolveProjectDirName() returns slug when exact dir not present', () => {
      const memexPath = '/tmp/memex';
      const result = resolveProjectDirName(memexPath, 'MyProject');
      assert.equal(result, 'myproject');
    });

    it('resolveProjectDirName() prefers an existing mixed-case legacy directory', () => {
      fs.mkdirSync(path.join(tmpDir, 'summaries', 'projects', 'DemoProject'));
      const result = resolveProjectDirName(tmpDir, 'demoproject');
      assert.equal(result, 'DemoProject');
    });

    it('resolveProjectDirName() reuses legacy directories that normalize to the same slug', () => {
      fs.mkdirSync(path.join(tmpDir, 'summaries', 'projects', 'My Project'), { recursive: true });
      const result = resolveProjectDirName(tmpDir, 'my-project');
      assert.equal(result, 'My Project');
    });

    it('resolveProjectDirName() still returns slug for brand new projects', () => {
      const result = resolveProjectDirName(tmpDir, 'Brand New Project');
      assert.equal(result, 'brand-new-project');
    });
  });
});
