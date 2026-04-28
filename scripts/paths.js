#!/usr/bin/env node

const fs = require('fs');
const path = require('path');

function hasIndexFiles(dir) {
  return (
    fs.existsSync(path.join(dir, 'index.json')) ||
    fs.existsSync(path.join(dir, 'index.json.gz')) ||
    fs.existsSync(path.join(dir, 'index.msgpack'))
  );
}

function findEngramRoot(startDir) {
  let current = path.resolve(startDir);
  while (true) {
    if (hasIndexFiles(current)) {
      return current;
    }
    const parent = path.dirname(current);
    if (parent === current) break;
    current = parent;
  }
  return null;
}

const USER_DATA_DIR = path.join(require('os').homedir(), '.engram');

function isGlobalInstall(dir) {
  return dir.includes(`${path.sep}node_modules${path.sep}`);
}

function resolveEngramPath(fromDir = __dirname) {
  if (process.env.ENGRAM_PATH) {
    return path.resolve(process.env.ENGRAM_PATH);
  }
  const found = findEngramRoot(fromDir);
  if (found) return found;
  // Global npm install: data lives in ~/.engram, not inside the package dir
  if (isGlobalInstall(fromDir) || fs.existsSync(USER_DATA_DIR)) {
    return USER_DATA_DIR;
  }
  return path.resolve(fromDir, '..');
}

function resolveReposRoot(engramPath) {
  if (process.env.ENGRAM_REPOS_ROOT) {
    return path.resolve(process.env.ENGRAM_REPOS_ROOT);
  }
  return path.resolve(engramPath, '..');
}

function normalizeProjectSlug(projectName) {
  return String(projectName || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
}

function listProjectDirectories(engramPath) {
  const projectsDir = path.join(engramPath, 'summaries', 'projects');
  if (!fs.existsSync(projectsDir)) return [];

  try {
    return fs.readdirSync(projectsDir, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name);
  } catch {
    return [];
  }
}

function resolveProjectDirName(engramPath, projectName) {
  const sanitized = String(projectName || '').replace(/[^a-zA-Z0-9._-]/g, '');
  const slug = normalizeProjectSlug(projectName);
  const projectsDir = listProjectDirectories(engramPath);

  // Prefer an existing exact directory name first.
  if (sanitized && projectsDir.includes(sanitized)) {
    return sanitized;
  }
  if (slug && projectsDir.includes(slug)) {
    return slug;
  }

  const normalizedCandidates = new Set(
    [sanitized, slug]
      .filter(Boolean)
      .map((value) => value.toLowerCase())
  );

  // Fall back to legacy directory names that normalize to the same slug.
  for (const dirName of projectsDir) {
    if (slug && normalizeProjectSlug(dirName) === slug) {
      return dirName;
    }
    if (normalizedCandidates.has(dirName.toLowerCase())) {
      return dirName;
    }
  }

  return slug || sanitized || '';
}

module.exports = {
  resolveEngramPath,
  resolveReposRoot,
  normalizeProjectSlug,
  resolveProjectDirName,
  listProjectDirectories
};
