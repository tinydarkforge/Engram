const fs = require('fs');
const path = require('path');
const { resolveCodicilPath } = require('./paths');
const { readJSON } = require('./safe-json');

const CODICIL_PATH = resolveCodicilPath(__dirname);
const INDEX_PATH = path.join(CODICIL_PATH, 'index.json');
const CURRENT_SCHEMA_VERSION = 1;

function atomicWriteFileSync(targetPath, content) {
  const dir = path.dirname(targetPath);
  fs.mkdirSync(dir, { recursive: true });
  const tmpPath = path.join(dir, `.tmp-${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}-${path.basename(targetPath)}`);
  const fd = fs.openSync(tmpPath, 'wx');
  try {
    fs.writeFileSync(fd, content);
    fs.fsyncSync(fd);
  } finally {
    fs.closeSync(fd);
  }
  fs.renameSync(tmpPath, targetPath);
}

function loadIndex() {
  return readJSON(INDEX_PATH);
}

function saveIndex(index) {
  atomicWriteFileSync(INDEX_PATH, JSON.stringify(index, null, 2));
}

function migrateToV1(index) {
  if (!index || typeof index !== 'object') return index;
  if (typeof index.schema_version !== 'number') {
    index.schema_version = 1;
  }
  return index;
}

const MIGRATIONS = [
  {
    from: 0,
    to: 1,
    run: migrateToV1
  }
];

function getSchemaVersion(index) {
  if (!index || typeof index !== 'object') return 0;
  const v = index.schema_version;
  return typeof v === 'number' ? v : 0;
}

function runMigrations() {
  const index = loadIndex();
  if (!index) {
    return { ok: false, error: 'index.json not found' };
  }

  let version = getSchemaVersion(index);
  let migrated = false;
  let current = index;

  while (version < CURRENT_SCHEMA_VERSION) {
    const migration = MIGRATIONS.find(m => m.from === version);
    if (!migration) {
      return { ok: false, error: `No migration found from schema_version ${version}` };
    }
    current = migration.run(current);
    version = migration.to;
    migrated = true;
  }

  if (migrated) {
    saveIndex(current);
  }

  return {
    ok: true,
    schema_version: version,
    migrated
  };
}

function runSqlMigrations(db) {
  const fs = require('fs');
  const path = require('path');

  // Ensure schema_migrations table exists
  db.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version       TEXT PRIMARY KEY,
      applied_at    TEXT NOT NULL
    );
  `);

  // SQL migration files live next to the package code, not in the data dir
  const migrationsDir = path.join(__dirname, '..', 'migrations');
  if (!fs.existsSync(migrationsDir)) {
    return { applied: [], skipped: [] };
  }

  const files = fs.readdirSync(migrationsDir)
    .filter(f => f.endsWith('.sql'))
    .sort();

  const applied = [];
  const skipped = [];

  for (const filename of files) {
    // Check if migration is already applied
    const existing = db.prepare('SELECT version FROM schema_migrations WHERE version = ?').get(filename);
    if (existing) {
      skipped.push(filename);
      continue;
    }

    // Read and execute migration
    const filePath = path.join(migrationsDir, filename);
    const content = fs.readFileSync(filePath, 'utf8');
    db.exec(content);

    // Record migration as applied
    const now = new Date().toISOString();
    db.prepare('INSERT INTO schema_migrations (version, applied_at) VALUES (?, ?)').run(filename, now);

    applied.push(filename);
  }

  return { applied, skipped };
}

module.exports = {
  CURRENT_SCHEMA_VERSION,
  runMigrations,
  getSchemaVersion,
  runSqlMigrations
};

if (require.main === module) {
  const Database = require('better-sqlite3');
  const path = require('path');
  const CODICIL_PATH = resolveCodicilPath(__dirname);
  const DB_PATH = path.join(CODICIL_PATH, '.cache', 'codicil.db');
  const cacheDir = path.dirname(DB_PATH);
  if (!require('fs').existsSync(cacheDir)) require('fs').mkdirSync(cacheDir, { recursive: true });
  const db = new Database(DB_PATH);
  const result = runSqlMigrations(db);
  console.log('SQL migrations applied:', result.applied);
  console.log('SQL migrations skipped:', result.skipped);
  db.close();
}

