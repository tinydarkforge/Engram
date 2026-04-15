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

function findMemexRoot(startDir) {
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

function resolveMemexPath(fromDir = __dirname) {
  if (process.env.MEMEX_PATH) {
    const envPath = path.resolve(process.env.MEMEX_PATH);
    return envPath;
  }
  const defaultPath = path.resolve(fromDir, '..');
  if (hasIndexFiles(defaultPath)) {
    return defaultPath;
  }
  const found = findMemexRoot(fromDir);
  return found || defaultPath;
}

function resolveReposRoot(memexPath) {
  if (process.env.MEMEX_REPOS_ROOT) {
    return path.resolve(process.env.MEMEX_REPOS_ROOT);
  }
  return path.resolve(memexPath, '..');
}

function normalizeProjectSlug(projectName) {
  return String(projectName || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
}

function listProjectDirectories(memexPath) {
  const projectsDir = path.join(memexPath, 'summaries', 'projects');
  if (!fs.existsSync(projectsDir)) return [];

  try {
    return fs.readdirSync(projectsDir, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name);
  } catch {
    return [];
  }
}

function resolveProjectDirName(memexPath, projectName) {
  const sanitized = String(projectName || '').replace(/[^a-zA-Z0-9._-]/g, '');
  const slug = normalizeProjectSlug(projectName);
  const projectsDir = listProjectDirectories(memexPath);

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
  resolveMemexPath,
  resolveReposRoot,
  normalizeProjectSlug,
  resolveProjectDirName,
  listProjectDirectories
};
