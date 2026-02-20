#!/usr/bin/env node

const path = require('path');

function resolveMemexPath(fromDir = __dirname) {
  if (process.env.MEMEX_PATH) {
    return path.resolve(process.env.MEMEX_PATH);
  }
  return path.resolve(fromDir, '..');
}

function resolveReposRoot(memexPath) {
  if (process.env.MEMEX_REPOS_ROOT) {
    return path.resolve(process.env.MEMEX_REPOS_ROOT);
  }
  return path.resolve(memexPath, '..');
}

module.exports = {
  resolveMemexPath,
  resolveReposRoot
};
