const fs = require('fs');
const path = require('path');
const { resolveMemexPath } = require('./paths');
const { readJSON } = require('./safe-json');

const MEMEX_PATH = resolveMemexPath(__dirname);
const INDEX_PATH = path.join(MEMEX_PATH, 'index.json');
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

module.exports = {
  CURRENT_SCHEMA_VERSION,
  runMigrations,
  getSchemaVersion
};

