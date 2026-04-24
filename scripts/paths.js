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

function findCodicilRoot(startDir) {
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

const USER_DATA_DIR = path.join(require('os').homedir(), '.codicil');

function isGlobalInstall(dir) {
  return dir.includes(`${path.sep}node_modules${path.sep}`);
}

function resolveCodicilPath(fromDir = __dirname) {
  if (process.env.CODICIL_PATH) {
    return path.resolve(process.env.CODICIL_PATH);
  }
  const found = findCodicilRoot(fromDir);
  if (found) return found;
  // Global npm install: data lives in ~/.codicil, not inside the package dir
  if (isGlobalInstall(fromDir) || fs.existsSync(USER_DATA_DIR)) {
    return USER_DATA_DIR;
  }
  return path.resolve(fromDir, '..');
}

function resolveReposRoot(codicilPath) {
  if (process.env.CODICIL_REPOS_ROOT) {
    return path.resolve(process.env.CODICIL_REPOS_ROOT);
  }
  return path.resolve(codicilPath, '..');
}

function normalizeProjectSlug(projectName) {
  return String(projectName || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
}

function listProjectDirectories(codicilPath) {
  const projectsDir = path.join(codicilPath, 'summaries', 'projects');
  if (!fs.existsSync(projectsDir)) return [];

  try {
    return fs.readdirSync(projectsDir, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name);
  } catch {
    return [];
  }
}

function resolveProjectDirName(codicilPath, projectName) {
  const sanitized = String(projectName || '').replace(/[^a-zA-Z0-9._-]/g, '');
  const slug = normalizeProjectSlug(projectName);
  const projectsDir = listProjectDirectories(codicilPath);

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
  resolveCodicilPath,
  resolveReposRoot,
  normalizeProjectSlug,
  resolveProjectDirName,
  listProjectDirectories
};
