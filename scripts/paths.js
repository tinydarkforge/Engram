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

function resolveProjectDirName(memexPath, projectName) {
  const sanitized = String(projectName || '').replace(/[^a-zA-Z0-9._-]/g, '');
  const exactDir = path.join(memexPath, 'summaries', 'projects', sanitized);
  if (sanitized && fs.existsSync(exactDir)) {
    return sanitized;
  }

  const slug = normalizeProjectSlug(projectName);
  if (!slug) {
    return sanitized || '';
  }
  const slugDir = path.join(memexPath, 'summaries', 'projects', slug);
  if (fs.existsSync(slugDir)) {
    return slug;
  }
  return slug;
}

module.exports = {
  resolveMemexPath,
  resolveReposRoot,
  normalizeProjectSlug,
  resolveProjectDirName
};
