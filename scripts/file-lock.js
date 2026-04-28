'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const LOCK_TTL_MS = 30 * 1000;

function atomicWriteFileSync(targetPath, content) {
  const dir = path.dirname(targetPath);
  fs.mkdirSync(dir, { recursive: true });
  const rand = crypto.randomBytes(6).toString('hex');
  const tmpPath = path.join(dir, `.tmp-${process.pid}-${Date.now()}-${rand}-${path.basename(targetPath)}`);
  const fd = fs.openSync(tmpPath, 'wx');
  try {
    fs.writeFileSync(fd, content);
    fs.fsyncSync(fd);
  } finally {
    fs.closeSync(fd);
  }
  fs.renameSync(tmpPath, targetPath);
}

function lockFilePath(targetPath) {
  return `${targetPath}.lock`;
}

async function withFileLock(targetPath, fn, { retries = 20, delayMs = 25 } = {}) {
  const dir = path.dirname(targetPath);
  fs.mkdirSync(dir, { recursive: true });
  const lockPath = lockFilePath(targetPath);
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const fd = fs.openSync(lockPath, 'wx');
      try {
        fs.writeFileSync(fd, JSON.stringify({ pid: process.pid, started_at: Date.now() }));
        fs.fsyncSync(fd);
        return await fn();
      } finally {
        fs.closeSync(fd);
        try { fs.unlinkSync(lockPath); } catch { /* best effort */ }
      }
    } catch (e) {
      if (e.code !== 'EEXIST') throw e;
      try {
        const stat = fs.statSync(lockPath);
        if (Date.now() - stat.mtimeMs > LOCK_TTL_MS) {
          fs.unlinkSync(lockPath);
          continue;
        }
      } catch (err) {
        if (err.code !== 'ENOENT') throw err;
      }
      if (attempt === retries) throw new Error(`Lock timeout for ${path.basename(targetPath)}`);
      await new Promise(resolve => setTimeout(resolve, delayMs));
    }
  }
}

module.exports = { LOCK_TTL_MS, atomicWriteFileSync, lockFilePath, withFileLock };
