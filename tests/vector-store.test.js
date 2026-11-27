'use strict';

const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const Database = require('better-sqlite3');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { runSqlMigrations } = require('../scripts/migrations');
const vectorStore = require('../scripts/vector-store');

function embedding(seed) {
  return Array.from({ length: 384 }, (_, i) => i === seed ? 1 : 0);
}

describe('SQLite vector store', () => {
  let fixture;
  let db;

  before(() => {
    fixture = fs.mkdtempSync(path.join(os.tmpdir(), 'engram-vector-store-'));
    db = new Database(path.join(fixture, 'engram.db'));
    const result = runSqlMigrations(db);
    assert.ok(result.applied.includes('0004_embedding_store.sql'));
  });

  after(() => {
    db.close();
    fs.rmSync(fixture, { recursive: true, force: true });
  });

  it('creates migration tables and vec0 virtual table', () => {
    const tables = db.prepare("SELECT name FROM sqlite_master WHERE name IN ('embedding_items', 'vec_embeddings')").all();
    assert.equal(tables.length, 2);
  });

  it('upserts, searches, and removes embeddings', () => {
    vectorStore.upsert(db, {
      entityType: 'session',
      entityId: 'session-a',
      project: 'Engram',
      textPreview: 'OAuth callback',
      embedding: embedding(1),
    });
    vectorStore.upsert(db, {
      entityType: 'session',
      entityId: 'session-b',
      project: 'Engram',
      textPreview: 'Database migration',
      embedding: embedding(2),
    });

    const results = vectorStore.search(db, embedding(1), { limit: 2, project: 'Engram' });
    assert.equal(results[0].entity_id, 'session-a');
    assert.equal(results[0].distance, 0);

    assert.equal(vectorStore.remove(db, 'session', 'session-a'), true);
    assert.equal(vectorStore.remove(db, 'session', 'missing'), false);
  });

  it('updates an existing entity without creating duplicate rowids', () => {
    vectorStore.upsert(db, {
      entityType: 'session',
      entityId: 'session-upsert',
      project: 'Engram',
      textPreview: 'Before',
      embedding: embedding(4),
    });
    vectorStore.upsert(db, {
      entityType: 'session',
      entityId: 'session-upsert',
      project: 'Engram',
      textPreview: 'After',
      embedding: embedding(5),
    });

    const rows = db.prepare("SELECT COUNT(*) AS count FROM embedding_items WHERE entity_type = 'session' AND entity_id = 'session-upsert'").get();
    const item = db.prepare("SELECT text_preview FROM embedding_items WHERE entity_type = 'session' AND entity_id = 'session-upsert'").get();
    assert.equal(rows.count, 1);
    assert.equal(item.text_preview, 'After');
  });

  it('rejects wrong embedding dimensions', () => {
    assert.throws(() => vectorStore.upsert(db, {
      entityType: 'session',
      entityId: 'bad',
      embedding: [1, 2, 3],
    }), /dimension mismatch/);
  });

  it('supports entity and project filtering', () => {
    vectorStore.upsert(db, {
      entityType: 'assertion',
      entityId: 'assertion-a',
      project: 'Engram',
      textPreview: 'A fact',
      embedding: embedding(3),
    });

    const results = vectorStore.search(db, embedding(3), {
      limit: 10,
      project: 'Engram',
      entityTypes: ['assertion'],
    });
    assert.equal(results.length, 1);
    assert.equal(results[0].entity_type, 'assertion');
  });
});
