#!/usr/bin/env node

const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const fs = require('fs');
const os = require('os');

describe('paths', () => {
  let originalCodicilPath;
  let originalReposRoot;
  let resolveCodicilPath;
  let resolveReposRoot;
  let resolveProjectDirName;
  let normalizeProjectSlug;
  let tmpDir;

  before(() => {
    originalCodicilPath = process.env.CODICIL_PATH;
    originalReposRoot = process.env.CODICIL_REPOS_ROOT;

    // Clear module cache
    Object.keys(require.cache)
      .filter(k => k.includes('paths'))
      .forEach(k => delete require.cache[k]);

    ({ resolveCodicilPath, resolveReposRoot, resolveProjectDirName, normalizeProjectSlug } = require('../scripts/paths'));
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'codicil-paths-'));
    fs.mkdirSync(path.join(tmpDir, 'summaries', 'projects'), { recursive: true });
  });

  after(() => {
    if (originalCodicilPath !== undefined) {
      process.env.CODICIL_PATH = originalCodicilPath;
    } else {
      delete process.env.CODICIL_PATH;
    }
    if (originalReposRoot !== undefined) {
      process.env.CODICIL_REPOS_ROOT = originalReposRoot;
    } else {
      delete process.env.CODICIL_REPOS_ROOT;
    }
    if (tmpDir) {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  describe('resolveCodicilPath()', () => {
    it('uses CODICIL_PATH env var when set', () => {
      process.env.CODICIL_PATH = '/custom/codicil';
      const result = resolveCodicilPath('/some/dir');
      assert.equal(result, path.resolve('/custom/codicil'));
    });

    it('defaults to parent of fromDir (or user data dir when it exists)', () => {
      delete process.env.CODICIL_PATH;
      const result = resolveCodicilPath('/a/b/scripts');
      const userDataDir = path.join(os.homedir(), '.codicil');
      const expected = fs.existsSync(userDataDir) ? userDataDir : path.resolve('/a/b');
      assert.equal(result, expected);
    });

    it('defaults to parent of __dirname when no arg', () => {
      delete process.env.CODICIL_PATH;
      const result = resolveCodicilPath();
      // Should resolve relative to current working directory's parent
      assert.ok(path.isAbsolute(result));
    });
  });

  describe('resolveReposRoot()', () => {
    it('uses CODICIL_REPOS_ROOT env var when set', () => {
      process.env.CODICIL_REPOS_ROOT = '/custom/repos';
      const result = resolveReposRoot('/some/codicil');
      assert.equal(result, path.resolve('/custom/repos'));
    });

    it('defaults to parent of codicilPath', () => {
      delete process.env.CODICIL_REPOS_ROOT;
      const result = resolveReposRoot('/code/org/Codicil');
      assert.equal(result, path.resolve('/code/org'));
    });
  });

  describe('project slug utilities', () => {
    it('normalizeProjectSlug() lowercases and replaces invalid chars', () => {
      const result = normalizeProjectSlug('My Project! 2026');
      assert.equal(result, 'my-project-2026');
    });

    it('resolveProjectDirName() returns slug when exact dir not present', () => {
      const codicilPath = '/tmp/codicil';
      const result = resolveProjectDirName(codicilPath, 'MyProject');
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
