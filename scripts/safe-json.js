#!/usr/bin/env node

/**
 * Safe JSON - Hardened JSON file reading and schema validation for Memex
 *
 * Wraps all JSON reads in try/catch with graceful fallback.
 * Validates required shapes for index.json and sessions-index.json.
 */

const fs = require('fs');

/**
 * Read and parse a JSON file safely.
 * Returns fallback on any error (missing file, corrupt JSON, permissions).
 */
function readJSON(filePath, fallback = null) {
  try {
    if (!fs.existsSync(filePath)) return fallback;
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch (e) {
    console.warn(`⚠️  Failed to read ${filePath}: ${e.message}`);
    return fallback;
  }
}

/**
 * Validate Memex index.json shape.
 * Returns { valid: true } or { valid: false, errors: [...] }.
 */
function validateIndex(data) {
  const errors = [];
  if (!data || typeof data !== 'object') {
    return { valid: false, errors: ['Index is not an object'] };
  }

  const required = ['v', 'u', 'm', 'g', 'p', 't'];
  for (const key of required) {
    if (data[key] === undefined) errors.push(`Missing required field: ${key}`);
  }

  if (data.m && typeof data.m === 'object') {
    if (typeof data.m.ts !== 'number') errors.push('m.ts (total_sessions) must be a number');
  }

  if (data.p && typeof data.p !== 'object') {
    errors.push('p (projects) must be an object');
  }

  if (data.t && typeof data.t !== 'object') {
    errors.push('t (topics) must be an object');
  }

  if (data.g && typeof data.g !== 'object') {
    errors.push('g (global_standards) must be an object');
  }

  return { valid: errors.length === 0, errors };
}

/**
 * Validate sessions-index.json shape.
 * Returns { valid: true } or { valid: false, errors: [...] }.
 */
function validateSessionsIndex(data) {
  const errors = [];
  if (!data || typeof data !== 'object') {
    return { valid: false, errors: ['Sessions index is not an object'] };
  }

  if (typeof data.project !== 'string') errors.push('Missing or invalid field: project');
  if (typeof data.total_sessions !== 'number') errors.push('Missing or invalid field: total_sessions');
  if (!Array.isArray(data.sessions)) errors.push('Missing or invalid field: sessions (must be array)');

  return { valid: errors.length === 0, errors };
}

module.exports = { readJSON, validateIndex, validateSessionsIndex };
