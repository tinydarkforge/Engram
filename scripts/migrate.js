#!/usr/bin/env node

const { runMigrations, CURRENT_SCHEMA_VERSION } = require('./migrations');

function main() {
  const result = runMigrations();
  if (!result.ok) {
    console.error(`Migration failed: ${result.error}`);
    process.exit(1);
  }

  if (result.migrated) {
    console.log(`Migrations complete. schema_version=${result.schema_version}`);
  } else {
    console.log(`No migrations needed. schema_version=${result.schema_version}`);
  }

  if (result.schema_version !== CURRENT_SCHEMA_VERSION) {
    console.warn(`Warning: expected schema_version ${CURRENT_SCHEMA_VERSION}, got ${result.schema_version}`);
  }
}

if (require.main === module) {
  main();
}

