'use strict';

const Database = require('better-sqlite3');
const sqliteVec = require('sqlite-vec');

function loadExtension(db) {
  sqliteVec.load(db);
}

function openDatabase(dbPath) {
  const db = new Database(dbPath);
  db.pragma('foreign_keys = ON');
  db.pragma('busy_timeout = 5000');
  loadExtension(db);
  return db;
}

function ensureVirtualTable(db) {
  loadExtension(db);
  db.exec(`CREATE VIRTUAL TABLE IF NOT EXISTS vec_embeddings
    USING vec0(embedding float[384])`);
}

function ensureMetadataTable(db) {
  db.exec(`CREATE TABLE IF NOT EXISTS embedding_items (
    vec_rowid INTEGER PRIMARY KEY,
    entity_type TEXT NOT NULL,
    entity_id TEXT NOT NULL,
    project TEXT,
    text_preview TEXT,
    embedding_json TEXT,
    model TEXT NOT NULL DEFAULT 'all-MiniLM-L6-v2',
    dimensions INTEGER NOT NULL,
    updated_at TEXT NOT NULL,
    UNIQUE(entity_type, entity_id)
  );
  CREATE INDEX IF NOT EXISTS idx_embedding_items_project ON embedding_items(project);
  CREATE INDEX IF NOT EXISTS idx_embedding_items_entity ON embedding_items(entity_type, entity_id);`);
}

function nextRowId(db) {
  const row = db.prepare('SELECT COALESCE(MAX(vec_rowid), 0) + 1 AS next_id FROM embedding_items').get();
  return row.next_id;
}

function upsert(db, item) {
  const embedding = Array.from(item.embedding || []);
  if (embedding.length !== 384) {
    throw new Error(`Embedding dimension mismatch: expected 384, got ${embedding.length}`);
  }

  ensureVirtualTable(db);
  ensureMetadataTable(db);

  const now = item.updatedAt || new Date().toISOString();
  let vecRowId;

  const transaction = db.transaction(() => {
    const existing = db.prepare(`
      SELECT vec_rowid FROM embedding_items
      WHERE entity_type = ? AND entity_id = ?
    `).get(item.entityType, item.entityId);

    vecRowId = existing ? existing.vec_rowid : nextRowId(db);

    if (existing) {
      db.prepare('DELETE FROM vec_embeddings WHERE rowid = ?').run(BigInt(vecRowId));
      db.prepare(`UPDATE embedding_items SET
        project = ?, text_preview = ?, embedding_json = ?, model = ?, dimensions = ?, updated_at = ?
        WHERE vec_rowid = ?`).run(
          item.project || null,
          item.textPreview || null,
          JSON.stringify(embedding),
          item.model || 'all-MiniLM-L6-v2',
          384,
          now,
          vecRowId
        );
    } else {
      db.prepare(`INSERT INTO embedding_items
        (vec_rowid, entity_type, entity_id, project, text_preview, embedding_json, model, dimensions, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
          vecRowId,
          item.entityType,
          item.entityId,
          item.project || null,
          item.textPreview || null,
          JSON.stringify(embedding),
          item.model || 'all-MiniLM-L6-v2',
          384,
          now
        );
    }

    db.prepare('INSERT INTO vec_embeddings(rowid, embedding) VALUES (?, ?)').run(
      BigInt(vecRowId),
      JSON.stringify(embedding)
    );
  });
  transaction();
  return vecRowId;
}

function remove(db, entityType, entityId) {
  const existing = db.prepare(`
    SELECT vec_rowid FROM embedding_items
    WHERE entity_type = ? AND entity_id = ?
  `).get(entityType, entityId);
  if (!existing) return false;

  const transaction = db.transaction(() => {
    db.prepare('DELETE FROM vec_embeddings WHERE rowid = ?').run(BigInt(existing.vec_rowid));
    db.prepare('DELETE FROM embedding_items WHERE vec_rowid = ?').run(existing.vec_rowid);
  });
  transaction();
  return true;
}

function search(db, queryEmbedding, options = {}) {
  const embedding = Array.from(queryEmbedding || []);
  if (embedding.length !== 384) {
    throw new Error(`Query embedding dimension mismatch: expected 384, got ${embedding.length}`);
  }

  const limit = Math.max(1, Math.min(Number(options.limit) || 20, 100));
  const candidateLimit = Math.max(limit * 10, limit);
  const rows = db.prepare(`
    SELECT rowid, distance
    FROM vec_embeddings
    WHERE embedding MATCH ?
    ORDER BY distance
    LIMIT ?
  `).all(JSON.stringify(embedding), candidateLimit);

  const entityTypes = Array.isArray(options.entityTypes) ? options.entityTypes : null;
  const results = [];

  for (const hit of rows) {
    const item = db.prepare(`
      SELECT * FROM embedding_items WHERE vec_rowid = ?
    `).get(hit.rowid);
    if (!item) continue;
    if (options.project && item.project !== options.project) continue;
    if (entityTypes && !entityTypes.includes(item.entity_type)) continue;

    results.push({
      entity_type: item.entity_type,
      entity_id: item.entity_id,
      project: item.project,
      text_preview: item.text_preview,
      model: item.model,
      distance: hit.distance,
      embedding: item.embedding_json ? JSON.parse(item.embedding_json) : null,
    });
    if (results.length >= limit) break;
  }

  return results;
}

function listItems(db) {
  return db.prepare(`
    SELECT entity_type, entity_id, project, text_preview, embedding_json, model, dimensions, updated_at
    FROM embedding_items
    ORDER BY updated_at DESC
  `).all().map((item) => ({
    ...item,
    embedding: item.embedding_json ? JSON.parse(item.embedding_json) : null,
  }));
}

module.exports = {
  loadExtension,
  openDatabase,
  ensureVirtualTable,
  ensureMetadataTable,
  upsert,
  remove,
  search,
  listItems,
};
