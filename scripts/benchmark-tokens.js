#!/usr/bin/env node

/**
 * benchmark-tokens.js
 *
 * Measures token savings of Codicil-assisted context retrieval vs. naive baseline.
 *
 * Baseline: all sessions + simulated git log + simulated file tree (raw dump)
 * Codicil:    only topic-matched sessions (structured retrieval, no raw dump)
 *
 * Reads exclusively from examples/benchmark-corpus/ — no live DB access.
 * Output is deterministic (no timestamps, no randomness).
 *
 * Exit codes:
 *   0  — all queries show >= 50% savings
 *   1  — at least one query shows < 50% savings (sanity check failure)
 */

'use strict';

const fs = require('fs');
const path = require('path');

// ---------------------------------------------------------------------------
// Token counting
// gpt-tokenizer is not in package.json. Fall back to a byte-based estimator
// that is consistent with GPT-4 cl100k_base characteristics:
//   ~4 bytes per token for English prose/JSON
// This is deterministic and sufficient for relative comparison.
// ---------------------------------------------------------------------------

let tokenizer = null;

function countTokens(text) {
  if (tokenizer) {
    return tokenizer.encode(text).length;
  }
  // Fallback: cl100k_base approximation — 1 token per ~4 bytes of UTF-8
  return Math.ceil(Buffer.byteLength(text, 'utf8') / 4);
}

// Try to load gpt-tokenizer if available
try {
  // gpt-tokenizer exports encode() for cl100k_base by default
  const gptTokenizer = require('gpt-tokenizer');
  tokenizer = gptTokenizer;
} catch (_) {
  // Not installed — use byte estimator (logged below)
}

// ---------------------------------------------------------------------------
// Corpus paths
// ---------------------------------------------------------------------------

const CORPUS_DIR = path.resolve(__dirname, '..', 'examples', 'benchmark-corpus');
const SESSIONS_DIR = path.join(CORPUS_DIR, 'sessions');
const QUERIES_DIR = path.join(CORPUS_DIR, 'queries');

// ---------------------------------------------------------------------------
// Synthetic baseline fixtures
// These represent the content an AI assistant would receive without Codicil.
// Fixed strings — never generated at runtime — to keep output deterministic.
// ---------------------------------------------------------------------------

// 150-line git log (6 months of activity across both projects)
// Each line: <hash> <type>(scope): <subject>
const SYNTHETIC_GIT_LOG = (() => {
  const types = ['feat', 'fix', 'chore', 'refactor', 'test', 'docs'];
  const scopes = [
    'auth', 'api', 'db', 'queue', 'cache', 'billing', 'reports',
    'users', 'tenants', 'config', 'migrations', 'workers', 'guards',
  ];
  const subjects = [
    'add per-tenant key rotation support',
    'fix null pointer in session middleware',
    'update dependencies to latest patch versions',
    'refactor repository layer to use query builder',
    'add integration tests for billing webhook',
    'fix race condition in token refresh flow',
    'chore: update eslint config to v9',
    'add pagination to audit log endpoint',
    'fix memory leak in worker process pool',
    'update OpenAPI spec for rate limit headers',
    'add prometheus metrics to queue workers',
    'refactor auth middleware to support RS256',
    'fix incorrect tenant scoping in reports query',
    'add database connection pool monitoring',
    'update README with deployment instructions',
  ];

  const lines = [];
  // Deterministic: use fixed seed-like index arithmetic, no Math.random()
  for (let i = 0; i < 150; i++) {
    const hash = (0xdeadbeef + i * 0x9e3779b9).toString(16).padStart(7, '0').slice(0, 7);
    const type = types[i % types.length];
    const scope = scopes[i % scopes.length];
    const subject = subjects[i % subjects.length];
    lines.push(`${hash} ${type}(${scope}): ${subject}`);
  }
  return lines.join('\n');
})();

// 200-entry file tree across both projects
const SYNTHETIC_FILE_TREE = (() => {
  const projAFiles = [
    'src/auth/jwt-middleware.ts',
    'src/auth/tenant-key-service.ts',
    'src/auth/tenant-key-service.test.ts',
    'src/auth/jwt-middleware.test.ts',
    'src/auth/index.ts',
    'src/models/audit-log.ts',
    'src/models/user.ts',
    'src/models/tenant.ts',
    'src/repositories/audit-log-repo.ts',
    'src/repositories/audit-log-repo.test.ts',
    'src/repositories/user-repo.ts',
    'src/repositories/tenant-repo.ts',
    'src/resolvers/report-resolver.ts',
    'src/resolvers/user-resolver.ts',
    'src/loaders/audit-count-loader.ts',
    'src/services/report-service.ts',
    'src/services/tenant-service.ts',
    'src/config/database.ts',
    'src/config/auth.ts',
    'src/app.ts',
    'src/main.ts',
    'migrations/0040_init.sql',
    'migrations/0041_users.sql',
    'migrations/0042_tenant_keys.sql',
    'migrations/0043_audit_log_partitioned.sql',
    'migrations/0043_backfill_audit_log.sql',
    'tests/integration/reports-latency.test.ts',
    'tests/integration/auth.test.ts',
    'tests/integration/audit.test.ts',
    'tests/e2e/login.spec.ts',
  ];

  const projBFiles = [
    'src/queues/email-queue.ts',
    'src/workers/email-worker.ts',
    'src/workers/email-worker.test.ts',
    'src/guards/rate-limit.guard.ts',
    'src/guards/rate-limit.guard.test.ts',
    'src/redis/sliding-window.lua',
    'src/redis/rate-limit-store.ts',
    'src/services/email-service.ts',
    'src/services/notification-service.ts',
    'src/config/redis.ts',
    'src/config/tenant-plan.ts',
    'src/middleware/response-headers.ts',
    'src/app.module.ts',
    'src/main.ts',
    'docker/email-worker.Dockerfile',
    'docker-compose.yml',
    'tests/integration/rate-limit.test.ts',
    'tests/integration/email-queue.test.ts',
    'tests/e2e/api-limits.spec.ts',
    'README.md',
  ];

  const shared = [
    '.github/workflows/ci.yml',
    '.github/workflows/deploy-stg.yml',
    '.github/workflows/deploy-prd.yml',
    '.eslintrc.json',
    '.prettierrc',
    'tsconfig.json',
    'package.json',
    'package-lock.json',
    'jest.config.ts',
    'Dockerfile',
  ];

  // Pad to 200 entries by repeating with depth variation
  const all = [];
  const prefixedA = projAFiles.map(f => `proj-a/${f}`);
  const prefixedB = projBFiles.map(f => `proj-b/${f}`);
  const prefixedShared = shared.map(f => `shared/${f}`);

  all.push(...prefixedA, ...prefixedB, ...prefixedShared);

  // Fill remaining slots with additional plausible paths (deterministic)
  const extras = [
    'docs/api-reference.md', 'docs/deployment.md', 'docs/architecture.md',
    'docs/runbooks/incident-response.md', 'docs/runbooks/db-maintenance.md',
    'scripts/seed-dev-db.ts', 'scripts/generate-keys.ts', 'scripts/health-check.ts',
    'infra/terraform/main.tf', 'infra/terraform/variables.tf',
    'infra/terraform/rds.tf', 'infra/terraform/elasticache.tf',
    'infra/k8s/deployment.yaml', 'infra/k8s/service.yaml',
    'infra/k8s/configmap.yaml', 'infra/k8s/hpa.yaml',
  ];

  all.push(...extras);

  // Repeat with numeric suffix until we hit 200
  let idx = 0;
  while (all.length < 200) {
    all.push(`proj-a/src/generated/schema-${idx}.ts`);
    idx++;
  }

  return all.slice(0, 200).join('\n');
})();

// ---------------------------------------------------------------------------
// Load corpus
// ---------------------------------------------------------------------------

function loadSessions() {
  const files = fs.readdirSync(SESSIONS_DIR)
    .filter(f => f.endsWith('.json'))
    .sort(); // deterministic order

  return files.map(f => {
    const raw = fs.readFileSync(path.join(SESSIONS_DIR, f), 'utf8');
    return JSON.parse(raw);
  });
}

function loadQueries() {
  const files = fs.readdirSync(QUERIES_DIR)
    .filter(f => f.endsWith('.json'))
    .sort();

  return files.map(f => {
    const raw = fs.readFileSync(path.join(QUERIES_DIR, f), 'utf8');
    return JSON.parse(raw);
  });
}

// ---------------------------------------------------------------------------
// Context builders
// ---------------------------------------------------------------------------

/**
 * Baseline: everything an AI assistant might receive without Codicil.
 * - All sessions as raw JSON dump
 * - Full git log
 * - Full file tree
 * - The query itself
 */
function buildBaselineContext(sessions, query) {
  const parts = [
    '## Recent Sessions (all, unfiltered)\n',
    JSON.stringify(sessions, null, 2),
    '\n## Git Log (last 6 months)\n',
    SYNTHETIC_GIT_LOG,
    '\n## Project File Tree\n',
    SYNTHETIC_FILE_TREE,
    '\n## Query\n',
    query.text,
  ];
  return parts.join('\n');
}

/**
 * Codicil-assisted: only topic-matched sessions, no raw git log or file tree.
 * Simulates what Codicil would retrieve and surface to the assistant.
 */
function buildCodicilContext(sessions, query) {
  const relevantTopics = new Set(query.relevant_topics);
  const relevantProjects = new Set(query.relevant_projects);

  const matched = sessions.filter(s => {
    const topicOverlap = s.topics && s.topics.some(t => relevantTopics.has(t));
    const projectMatch = !s.project || relevantProjects.has(s.project);
    return topicOverlap && projectMatch;
  });

  // Render matched sessions as a structured summary (what Codicil would emit)
  const summaries = matched.map(s => {
    const lines = [
      `### ${s.id} (${s.date})`,
      `**Summary:** ${s.summary}`,
      `**Topics:** ${(s.topics || []).join(', ')}`,
    ];

    if (s.key_decisions && s.key_decisions.length > 0) {
      lines.push(`**Key Decisions:**`);
      s.key_decisions.forEach(d => lines.push(`- ${d}`));
    }

    if (s.learnings && s.learnings.length > 0) {
      lines.push(`**Learnings:**`);
      s.learnings.forEach(l => lines.push(`- ${l}`));
    }

    if (s.outcomes && s.outcomes.next_steps && s.outcomes.next_steps.length > 0) {
      lines.push(`**Next Steps:**`);
      s.outcomes.next_steps.forEach(n => lines.push(`- ${n}`));
    }

    if (s.code_changes) {
      const cc = s.code_changes;
      const changed = [
        ...(cc.files_added || []).map(f => `+ ${f}`),
        ...(cc.files_modified || []).map(f => `~ ${f}`),
        ...(cc.files_deleted || []).map(f => `- ${f}`),
      ];
      if (changed.length > 0) {
        lines.push(`**Files:**`);
        changed.forEach(f => lines.push(`  ${f}`));
      }
    }

    return lines.join('\n');
  });

  const parts = [
    `## Relevant Sessions (${matched.length} of ${sessions.length} matched)\n`,
    summaries.join('\n\n'),
    '\n## Query\n',
    query.text,
  ];
  return parts.join('\n');
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

function run() {
  const tokenizerLabel = tokenizer ? 'gpt-tokenizer (cl100k_base)' : 'byte estimator (~4 bytes/token)';

  const sessions = loadSessions();
  const queries = loadQueries();

  const colWidths = { type: 18, base: 16, codicil: 14, savings: 10 };
  const divider = '-'.repeat(66);

  console.log('\nCodicil Token Savings Benchmark');
  console.log(`Tokenizer : ${tokenizerLabel}`);
  console.log(`Sessions  : ${sessions.length}`);
  console.log(`Queries   : ${queries.length}`);
  console.log(divider);
  console.log(
    'Query Type'.padEnd(colWidths.type) +
    'Baseline Tokens'.padStart(colWidths.base) +
    'Codicil Tokens'.padStart(colWidths.codicil) +
    'Savings %'.padStart(colWidths.savings)
  );
  console.log(divider);

  const results = [];
  let failed = false;

  for (const query of queries) {
    const baselineCtx = buildBaselineContext(sessions, query);
    const codicilCtx = buildCodicilContext(sessions, query);

    const baselineTokens = countTokens(baselineCtx);
    const codicilTokens = countTokens(codicilCtx);
    const savingsPct = ((1 - codicilTokens / baselineTokens) * 100).toFixed(1);
    const savingsNum = parseFloat(savingsPct);

    results.push({ query, baselineTokens, codicilTokens, savingsPct });

    if (savingsNum < 50) {
      failed = true;
    }

    console.log(
      query.type.padEnd(colWidths.type) +
      baselineTokens.toString().padStart(colWidths.base) +
      codicilTokens.toString().padStart(colWidths.codicil) +
      `${savingsPct}%`.padStart(colWidths.savings)
    );
  }

  console.log(divider);

  // Summary row
  const totalBase = results.reduce((s, r) => s + r.baselineTokens, 0);
  const totalCodicil = results.reduce((s, r) => s + r.codicilTokens, 0);
  const avgSavings = ((1 - totalCodicil / totalBase) * 100).toFixed(1);

  console.log(
    'AVERAGE'.padEnd(colWidths.type) +
    totalBase.toString().padStart(colWidths.base) +
    totalCodicil.toString().padStart(colWidths.codicil) +
    `${avgSavings}%`.padStart(colWidths.savings)
  );
  console.log(divider);
  console.log();

  if (failed) {
    console.error('FAIL: one or more queries show < 50% token savings.');
    console.error('This suggests the corpus or matching logic needs review.');
    process.exit(1);
  }

  console.log(`PASS: all queries show >= 50% token savings (average ${avgSavings}%)`);
  console.log();
}

run();
