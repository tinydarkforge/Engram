#!/usr/bin/env node

/**
 * Memex Performance Benchmark
 *
 * Tests Memex performance with 1000+ sessions to validate:
 * - Index load times
 * - Search performance
 * - Bloom filter effectiveness
 * - Lazy loading benefits
 * - Memory efficiency
 */

const fs = require('fs');
const path = require('path');
const Memex = require('./memex-loader');
const BloomFilter = require('./bloom-filter');

const BENCHMARK_DIR = path.join(__dirname, '../.benchmark');

// Utility to measure time
function measure(name, fn) {
  const start = Date.now();
  const result = fn();
  const duration = Date.now() - start;
  return { name, duration, result };
}

async function measureAsync(name, fn) {
  const start = Date.now();
  const result = await fn();
  const duration = Date.now() - start;
  return { name, duration, result };
}

// Generate test sessions
function generateTestSessions(count) {
  const topics = [
    'auth', 'oauth', 'jwt', 'security', 'api', 'database', 'performance',
    'optimization', 'docker', 'kubernetes', 'deployment', 'cicd', 'testing',
    'frontend', 'backend', 'react', 'typescript', 'nodejs', 'python',
    'redis', 'postgresql', 'mongodb', 'elasticsearch', 'graphql', 'rest',
    'microservices', 'monorepo', 'architecture', 'refactoring', 'bugfix',
    'feature', 'hotfix', 'monitoring', 'logging', 'debugging', 'profiling'
  ];

  const sessions = [];

  for (let i = 0; i < count; i++) {
    const sessionTopics = [];
    const topicCount = 2 + Math.floor(Math.random() * 4); // 2-6 topics
    for (let j = 0; j < topicCount; j++) {
      sessionTopics.push(topics[Math.floor(Math.random() * topics.length)]);
    }

    const date = new Date(2025, 0, 1 + Math.floor(i / 10)); // Spread across ~100 days
    const dateStr = date.toISOString().split('T')[0];

    sessions.push({
      id: `benchmark-${dateStr}-session-${i}`,
      project: 'BenchmarkProject',
      date: dateStr,
      summary: `Benchmark session ${i} - ${sessionTopics.join(', ')} work`,
      topics: sessionTopics,
      key_decisions: [
        `Decision ${i}-1: Important architectural choice`,
        `Decision ${i}-2: Performance optimization approach`
      ],
      outcomes: [
        `Outcome ${i}-1: Successfully implemented feature`,
        `Outcome ${i}-2: Improved performance by ${10 + Math.floor(Math.random() * 90)}%`
      ],
      learnings: [
        `Learning ${i}-1: Best practice discovered`,
        `Learning ${i}-2: Anti-pattern to avoid`
      ],
      code_changes: {
        files_added: [`new-file-${i}.ts`],
        files_modified: [`existing-${i}.ts`, `utils-${i}.ts`],
        files_deleted: [],
        lines_added: 50 + Math.floor(Math.random() * 200),
        lines_removed: 10 + Math.floor(Math.random() * 50)
      }
    });
  }

  return sessions;
}

// Setup benchmark environment
function setup(sessionCount) {
  console.log(`\n🏗️  Setting up benchmark environment...`);
  console.log(`   Generating ${sessionCount} test sessions...\n`);

  if (!fs.existsSync(BENCHMARK_DIR)) {
    fs.mkdirSync(BENCHMARK_DIR, { recursive: true });
  }

  const sessions = generateTestSessions(sessionCount);

  // Create sessions index (full - no lazy loading)
  const fullIndex = {
    project: 'BenchmarkProject',
    total_sessions: sessions.length,
    last_updated: new Date().toISOString().split('T')[0],
    sessions: sessions
  };

  fs.writeFileSync(
    path.join(BENCHMARK_DIR, 'sessions-full.json'),
    JSON.stringify(fullIndex, null, 2)
  );

  // Create lazy loaded index (lightweight only)
  const lazyIndex = {
    project: 'BenchmarkProject',
    total_sessions: sessions.length,
    last_updated: new Date().toISOString().split('T')[0],
    sessions: sessions.map(s => ({
      id: s.id,
      project: s.project,
      date: s.date,
      summary: s.summary,
      topics: s.topics
    }))
  };

  fs.writeFileSync(
    path.join(BENCHMARK_DIR, 'sessions-lazy.json'),
    JSON.stringify(lazyIndex, null, 2)
  );

  // Save individual session details
  const detailsDir = path.join(BENCHMARK_DIR, 'details');
  if (!fs.existsSync(detailsDir)) {
    fs.mkdirSync(detailsDir, { recursive: true });
  }

  sessions.forEach(s => {
    const details = {
      key_decisions: s.key_decisions,
      outcomes: s.outcomes,
      learnings: s.learnings,
      code_changes: s.code_changes
    };

    fs.writeFileSync(
      path.join(detailsDir, `${s.id}.json`),
      JSON.stringify(details, null, 2)
    );
  });

  console.log(`✅ Generated ${sessionCount} sessions`);
  console.log(`   Full index: ${(fs.statSync(path.join(BENCHMARK_DIR, 'sessions-full.json')).size / 1024).toFixed(2)} KB`);
  console.log(`   Lazy index: ${(fs.statSync(path.join(BENCHMARK_DIR, 'sessions-lazy.json')).size / 1024).toFixed(2)} KB\n`);

  return sessions;
}

// Benchmark 1: Index load time
function benchmarkIndexLoad() {
  console.log('📊 Benchmark 1: Index Load Time\n');

  const fullPath = path.join(BENCHMARK_DIR, 'sessions-full.json');
  const lazyPath = path.join(BENCHMARK_DIR, 'sessions-lazy.json');

  // Load full index
  const fullResult = measure('Full index load', () => {
    return JSON.parse(fs.readFileSync(fullPath, 'utf8'));
  });

  // Load lazy index
  const lazyResult = measure('Lazy index load', () => {
    return JSON.parse(fs.readFileSync(lazyPath, 'utf8'));
  });

  const improvement = ((1 - lazyResult.duration / fullResult.duration) * 100).toFixed(1);

  console.log(`   Full:  ${fullResult.duration}ms`);
  console.log(`   Lazy:  ${lazyResult.duration}ms`);
  console.log(`   ⚡ ${improvement}% faster with lazy loading\n`);

  return { fullResult, lazyResult, improvement };
}

// Benchmark 2: Search performance
function benchmarkSearch(sessions) {
  console.log('📊 Benchmark 2: Search Performance\n');

  const searchTerms = ['auth', 'docker', 'performance', 'api', 'nonexistent'];

  searchTerms.forEach(term => {
    const result = measure(`Search for "${term}"`, () => {
      return sessions.filter(s =>
        s.topics.includes(term) ||
        s.summary.toLowerCase().includes(term)
      );
    });

    console.log(`   "${term}": ${result.duration}ms (${result.result.length} results)`);
  });

  console.log('');
}

// Benchmark 3: Bloom filter effectiveness
function benchmarkBloomFilter(sessions) {
  console.log('📊 Benchmark 3: Bloom Filter Effectiveness\n');

  // Build bloom filter with all topics
  const allTopics = new Set();
  sessions.forEach(s => {
    s.topics.forEach(t => allTopics.add(t));
  });

  const filterBuildResult = measure('Build bloom filter', () => {
    const filter = new BloomFilter(allTopics.size * 2, 0.01);
    allTopics.forEach(topic => filter.add(topic));
    return filter;
  });

  const filter = filterBuildResult.result;

  console.log(`   Build time: ${filterBuildResult.duration}ms`);
  console.log(`   Topics: ${allTopics.size}`);
  console.log(`   Size: ${filter.getStats().size_bytes} bytes\n`);

  // Test negative queries (items NOT in filter)
  const negativeTerms = ['kubernetes', 'graphql', 'python', 'java', 'rust'];

  console.log('   Negative queries (instant "NO"):');
  negativeTerms.forEach(term => {
    const result = measure(`Check "${term}"`, () => {
      return filter.mightContain(term);
    });

    console.log(`   - "${term}": ${result.duration}ms (result: ${result.result ? 'maybe' : 'definitely not'})`);
  });

  console.log('');
}

// Benchmark 4: Memory usage
function benchmarkMemory() {
  console.log('📊 Benchmark 4: Memory Usage\n');

  const fullPath = path.join(BENCHMARK_DIR, 'sessions-full.json');
  const lazyPath = path.join(BENCHMARK_DIR, 'sessions-lazy.json');

  const fullSize = fs.statSync(fullPath).size;
  const lazySize = fs.statSync(lazyPath).size;

  const reduction = ((1 - lazySize / fullSize) * 100).toFixed(1);

  console.log(`   Full index:  ${(fullSize / 1024).toFixed(2)} KB`);
  console.log(`   Lazy index:  ${(lazySize / 1024).toFixed(2)} KB`);
  console.log(`   💾 ${reduction}% reduction\n`);

  return { fullSize, lazySize, reduction };
}

// Benchmark 5: Lazy loading on-demand
function benchmarkLazyLoadingOnDemand(sessions) {
  console.log('📊 Benchmark 5: Lazy Loading On-Demand\n');

  // Simulate loading 10 session details
  const detailsDir = path.join(BENCHMARK_DIR, 'details');
  const sessionIds = sessions.slice(0, 10).map(s => s.id);

  const result = measure('Load 10 session details', () => {
    return sessionIds.map(id => {
      const detailsPath = path.join(detailsDir, `${id}.json`);
      return JSON.parse(fs.readFileSync(detailsPath, 'utf8'));
    });
  });

  console.log(`   Time: ${result.duration}ms`);
  console.log(`   Avg per session: ${(result.duration / 10).toFixed(2)}ms\n`);
}

// Benchmark 6: Scalability test
function benchmarkScalability() {
  console.log('📊 Benchmark 6: Scalability Test\n');

  const counts = [100, 500, 1000, 2000, 5000];

  console.log('   Sessions | Load Time | Search Time | Size (KB)');
  console.log('   ---------|-----------|-------------|----------');

  counts.forEach(count => {
    const sessions = generateTestSessions(count);

    const loadResult = measure('load', () => {
      return JSON.stringify(sessions);
    });

    const searchResult = measure('search', () => {
      return sessions.filter(s => s.topics.includes('auth'));
    });

    const sizeKB = (Buffer.byteLength(loadResult.result, 'utf8') / 1024).toFixed(2);

    console.log(`   ${count.toString().padStart(8)} | ${loadResult.duration.toString().padStart(9)}ms | ${searchResult.duration.toString().padStart(11)}ms | ${sizeKB.padStart(9)}`);
  });

  console.log('');
}

// Main benchmark runner
async function runBenchmarks() {
  console.log('\n' + '='.repeat(70));
  console.log('🚀 Memex Performance Benchmark');
  console.log('='.repeat(70));

  const sessionCount = parseInt(process.argv[2]) || 1000;

  // Setup
  const sessions = setup(sessionCount);

  // Run benchmarks
  benchmarkIndexLoad();
  benchmarkSearch(sessions);
  benchmarkBloomFilter(sessions);
  benchmarkMemory();
  benchmarkLazyLoadingOnDemand(sessions);
  benchmarkScalability();

  console.log('='.repeat(70));
  console.log('✅ Benchmark complete!\n');

  // Cleanup
  if (process.argv.includes('--cleanup')) {
    fs.rmSync(BENCHMARK_DIR, { recursive: true, force: true });
    console.log('🧹 Cleaned up benchmark data\n');
  } else {
    console.log(`💡 Benchmark data saved in: ${BENCHMARK_DIR}`);
    console.log(`   Run with --cleanup to remove\n`);
  }
}

// Run if called directly
if (require.main === module) {
  runBenchmarks().catch(console.error);
}

module.exports = { generateTestSessions, measure, measureAsync };
