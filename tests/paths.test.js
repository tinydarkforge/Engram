#!/usr/bin/env node

const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const fs = require('fs');
const os = require('os');

describe('paths', () => {
  let originalEngramPath;
  let originalReposRoot;
  let resolveEngramPath;
  let resolveReposRoot;
  let resolveProjectDirName;
  let normalizeProjectSlug;
  let tmpDir;

  before(() => {
    originalEngramPath = process.env.ENGRAM_PATH;
    originalReposRoot = process.env.ENGRAM_REPOS_ROOT;

    // Clear module cache
    Object.keys(require.cache)
      .filter(k => k.includes('paths'))
      .forEach(k => delete require.cache[k]);

    ({ resolveEngramPath, resolveReposRoot, resolveProjectDirName, normalizeProjectSlug } = require('../scripts/paths'));
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'engram-paths-'));
    fs.mkdirSync(path.join(tmpDir, 'summaries', 'projects'), { recursive: true });
  });

  after(() => {
    if (originalEngramPath !== undefined) {
      process.env.ENGRAM_PATH = originalEngramPath;
    } else {
      delete process.env.ENGRAM_PATH;
    }
    if (originalReposRoot !== undefined) {
      process.env.ENGRAM_REPOS_ROOT = originalReposRoot;
    } else {
      delete process.env.ENGRAM_REPOS_ROOT;
    }
    if (tmpDir) {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  describe('resolveEngramPath()', () => {
    it('uses ENGRAM_PATH env var when set', () => {
      process.env.ENGRAM_PATH = '/custom/engram';
      const result = resolveEngramPath('/some/dir');
      assert.equal(result, path.resolve('/custom/engram'));
    });

    it('defaults to parent of fromDir (or user data dir when it exists)', () => {
      delete process.env.ENGRAM_PATH;
      const result = resolveEngramPath('/a/b/scripts');
      const userDataDir = path.join(os.homedir(), '.engram');
      const expected = fs.existsSync(userDataDir) ? userDataDir : path.resolve('/a/b');
      assert.equal(result, expected);
    });

    it('defaults to parent of __dirname when no arg', () => {
      delete process.env.ENGRAM_PATH;
      const result = resolveEngramPath();
      // Should resolve relative to current working directory's parent
      assert.ok(path.isAbsolute(result));
    });
  });

  describe('resolveReposRoot()', () => {
    it('uses ENGRAM_REPOS_ROOT env var when set', () => {
      process.env.ENGRAM_REPOS_ROOT = '/custom/repos';
      const result = resolveReposRoot('/some/engram');
      assert.equal(result, path.resolve('/custom/repos'));
    });

    it('defaults to parent of engramPath', () => {
      delete process.env.ENGRAM_REPOS_ROOT;
      const result = resolveReposRoot('/code/org/Engram');
      assert.equal(result, path.resolve('/code/org'));
    });
  });

  describe('project slug utilities', () => {
    it('normalizeProjectSlug() lowercases and replaces invalid chars', () => {
      const result = normalizeProjectSlug('My Project! 2026');
      assert.equal(result, 'my-project-2026');
    });

    it('resolveProjectDirName() returns slug when exact dir not present', () => {
      const engramPath = '/tmp/engram';
      const result = resolveProjectDirName(engramPath, 'MyProject');
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
