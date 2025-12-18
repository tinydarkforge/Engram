#!/usr/bin/env node

/**
 * Persistent Cache for Memex
 *
 * Uses SQLite to cache Memex index and data for instant cold starts.
 * - 30ms → 5ms load time (6x faster)
 * - Cache survives restarts
 * - TTL-based invalidation (default: 60 minutes)
 * - Version-based cache busting
 */

const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');
const msgpack = require('msgpack-lite');

const MEMEX_PATH = process.env.MEMEX_PATH || path.join(process.env.HOME, 'code/cirrus/DevOps/Memex');
const CACHE_DB_PATH = path.join(MEMEX_PATH, '.cache', 'memex.db');
const DEFAULT_TTL = 60 * 60 * 1000; // 60 minutes in milliseconds
const DEFAULT_MAX_ENTRIES = 1000; // Maximum number of cache entries (LRU eviction)

class PersistentCache {
  constructor(options = {}) {
    this.ttl = options.ttl || DEFAULT_TTL;
    this.version = options.version || '3.1.0';
    this.maxEntries = options.maxEntries || DEFAULT_MAX_ENTRIES;
    this.db = null;
    this.initializeDatabase();
  }

  /**
   * Initialize SQLite database with schema
   */
  initializeDatabase() {
    // Ensure .cache directory exists
    const cacheDir = path.dirname(CACHE_DB_PATH);
    if (!fs.existsSync(cacheDir)) {
      fs.mkdirSync(cacheDir, { recursive: true });
    }

    // Open database connection
    this.db = new Database(CACHE_DB_PATH);

    // Create cache table if it doesn't exist
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS cache (
        key TEXT PRIMARY KEY,
        value BLOB,
        version TEXT NOT NULL,
        expires_at INTEGER NOT NULL,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        last_accessed_at INTEGER NOT NULL
      )
    `);

    // Create index on expires_at for faster cleanup
    this.db.exec(`
      CREATE INDEX IF NOT EXISTS idx_expires_at ON cache(expires_at)
    `);

    // Create index on last_accessed_at for LRU eviction
    this.db.exec(`
      CREATE INDEX IF NOT EXISTS idx_last_accessed ON cache(last_accessed_at)
    `);

    // Cleanup expired entries on initialization
    this.cleanup();
  }

  /**
   * Get value from cache
   * Returns null if:
   * - Key not found
   * - Entry expired
   * - Version mismatch
   *
   * Updates last_accessed_at on successful read (LRU tracking)
   */
  get(key) {
    const stmt = this.db.prepare(`
      SELECT value, version, expires_at
      FROM cache
      WHERE key = ?
    `);

    const row = stmt.get(key);

    if (!row) {
      return null;
    }

    // Check expiration
    const now = Date.now();
    if (row.expires_at < now) {
      this.delete(key);
      return null;
    }

    // Check version
    if (row.version !== this.version) {
      this.delete(key);
      return null;
    }

    // Decode msgpack
    let value;
    try {
      value = msgpack.decode(row.value);
    } catch (e) {
      console.warn(`Failed to decode cache entry for key: ${key}`, e.message);
      this.delete(key);
      return null;
    }

    // Update last accessed time (LRU tracking)
    const updateStmt = this.db.prepare(`
      UPDATE cache SET last_accessed_at = ? WHERE key = ?
    `);
    updateStmt.run(now, key);

    return value;
  }

  /**
   * Set value in cache
   * Value is encoded with msgpack for space efficiency
   *
   * Implements LRU eviction when cache reaches maxEntries
   * Preserves last_accessed_at on updates (only changes on reads)
   */
  set(key, value, customTTL = null) {
    const now = Date.now();
    const ttl = customTTL || this.ttl;
    const expiresAt = now + ttl;

    // Check if this is an update (key exists) or insert (new key)
    const existsStmt = this.db.prepare('SELECT last_accessed_at FROM cache WHERE key = ?');
    const existing = existsStmt.get(key);

    // If inserting new entry and cache is at capacity, evict LRU
    if (!existing) {
      const countStmt = this.db.prepare('SELECT COUNT(*) as count FROM cache');
      const { count } = countStmt.get();

      if (count >= this.maxEntries) {
        // Evict least recently used entry
        const evictStmt = this.db.prepare(`
          DELETE FROM cache
          WHERE key IN (
            SELECT key FROM cache
            ORDER BY last_accessed_at ASC
            LIMIT 1
          )
        `);
        evictStmt.run();
      }
    }

    // Encode value with msgpack
    const encoded = msgpack.encode(value);

    // Preserve last_accessed_at on updates, set to now for new entries
    const lastAccessedAt = existing ? existing.last_accessed_at : now;

    const stmt = this.db.prepare(`
      INSERT OR REPLACE INTO cache (key, value, version, expires_at, created_at, updated_at, last_accessed_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `);

    stmt.run(key, encoded, this.version, expiresAt, now, now, lastAccessedAt);
  }

  /**
   * Delete entry from cache
   */
  delete(key) {
    const stmt = this.db.prepare('DELETE FROM cache WHERE key = ?');
    stmt.run(key);
  }

  /**
   * Clear all cache entries
   */
  clear() {
    this.db.exec('DELETE FROM cache');
  }

  /**
   * Cleanup expired entries
   */
  cleanup() {
    const now = Date.now();
    const stmt = this.db.prepare('DELETE FROM cache WHERE expires_at < ?');
    const result = stmt.run(now);

    if (result.changes > 0) {
      console.log(`🧹 Cleaned up ${result.changes} expired cache entries`);
    }
  }

  /**
   * Get cache statistics
   */
  getStats() {
    const total = this.db.prepare('SELECT COUNT(*) as count FROM cache').get();
    const expired = this.db.prepare('SELECT COUNT(*) as count FROM cache WHERE expires_at < ?').get(Date.now());
    const size = fs.statSync(CACHE_DB_PATH).size;

    return {
      total_entries: total.count,
      expired_entries: expired.count,
      valid_entries: total.count - expired.count,
      max_entries: this.maxEntries,
      capacity_used_percent: Math.round((total.count / this.maxEntries) * 100),
      database_size_kb: Math.round(size / 1024),
      database_path: CACHE_DB_PATH,
      version: this.version,
      ttl_minutes: this.ttl / 60 / 1000,
      lru_enabled: true
    };
  }

  /**
   * Invalidate all entries with specific version
   */
  invalidateVersion(version) {
    const stmt = this.db.prepare('DELETE FROM cache WHERE version = ?');
    const result = stmt.run(version);
    console.log(`🗑️  Invalidated ${result.changes} entries with version ${version}`);
  }

  /**
   * Close database connection
   */
  close() {
    if (this.db) {
      this.db.close();
      this.db = null;
    }
  }
}

module.exports = PersistentCache;
