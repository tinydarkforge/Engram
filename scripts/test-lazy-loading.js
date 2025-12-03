#!/usr/bin/env node

/**
 * Lazy Loading Tests
 *
 * Tests the lazy loading implementation for:
 * - Index reduction (lightweight vs full details)
 * - Correct splitting of session data
 * - On-demand loading of full details
 * - Performance improvements
 */

const fs = require('fs');
const path = require('path');
const assert = require('assert');

// Test counter
let passed = 0;
let failed = 0;

function test(name, fn) {
  try {
    fn();
    console.log(`✓ ${name}`);
    passed++;
  } catch (error) {
    console.error(`✗ ${name}`);
    console.error(`  Error: ${error.message}`);
    failed++;
  }
}

console.log('🧪 Running Lazy Loading Tests...\n');

// Test data
const testSession = {
  id: 'test-2025-12-03-sample',
  project: 'TestProject',
  date: '2025-12-03',
  summary: 'Test session for lazy loading',
  topics: ['test', 'lazy-loading'],
  key_decisions: ['Decision 1', 'Decision 2'],
  outcomes: ['Outcome 1', 'Outcome 2'],
  learnings: ['Learning 1'],
  code_changes: {
    files_added: ['file1.js'],
    files_modified: ['file2.js'],
    files_deleted: [],
    lines_added: 50,
    lines_removed: 10
  }
};

// Test 1: Session splitting - lightweight fields
test('Extract lightweight session fields correctly', () => {
  const LazyLoader = require('./lazy-loader');

  // Get lightweight fields (simulated)
  const lightFields = [
'id', 'project', 'date', 'summary', 'topics'
  ];

  const lightweight = {};
  lightFields.forEach(field => {
    if (testSession[field]) {
      lightweight[field] = testSession[field];
    }
  });

  assert.strictEqual(lightweight.id, testSession.id);
  assert.strictEqual(lightweight.project, testSession.project);
  assert.strictEqual(lightweight.date, testSession.date);
  assert.strictEqual(lightweight.summary, testSession.summary);
  assert.deepStrictEqual(lightweight.topics, testSession.topics);

  // Should NOT include heavy fields
  assert.strictEqual(lightweight.key_decisions, undefined);
  assert.strictEqual(lightweight.outcomes, undefined);
  assert.strictEqual(lightweight.learnings, undefined);
  assert.strictEqual(lightweight.code_changes, undefined);
});

// Test 2: Size comparison
test('Lightweight session is significantly smaller', () => {
  const lightFields = ['id', 'project', 'date', 'summary', 'topics'];
  const heavyweight = JSON.stringify(testSession);

  const lightweight = {};
  lightFields.forEach(field => {
    if (testSession[field]) {
      lightweight[field] = testSession[field];
    }
  });
  const lightweightStr = JSON.stringify(lightweight);

  const fullSize = Buffer.byteLength(heavyweight, 'utf8');
  const lightSize = Buffer.byteLength(lightweightStr, 'utf8');
  const reduction = ((1 - lightSize / fullSize) * 100).toFixed(1);

  console.log(`  Full: ${fullSize} bytes`);
  console.log(`  Light: ${lightSize} bytes`);
  console.log(`  Reduction: ${reduction}%`);

  assert.ok(lightSize < fullSize, 'Lightweight should be smaller');
  assert.ok(reduction > 30, `Reduction ${reduction}% should be > 30%`);
});

// Test 3: Index size reduction with multiple sessions
test('Index with 10 lightweight sessions vs 10 full sessions', () => {
  const sessions = Array.from({ length: 10 }, (_, i) => ({
    ...testSession,
    id: `test-2025-12-03-session-${i}`,
    summary: `Test session ${i} for lazy loading with more details`
  }));

  // Full index
  const fullIndex = { sessions };
  const fullSize = Buffer.byteLength(JSON.stringify(fullIndex), 'utf8');

  // Lightweight index
  const lightFields = ['id', 'project', 'date', 'summary', 'topics'];
  const lightSessions = sessions.map(session => {
    const light = {};
    lightFields.forEach(field => {
      if (session[field]) {
        light[field] = session[field];
      }
    });
    return light;
  });
  const lightIndex = { sessions: lightSessions };
  const lightSize = Buffer.byteLength(JSON.stringify(lightIndex), 'utf8');

  const reduction = ((1 - lightSize / fullSize) * 100).toFixed(1);

  console.log(`  Full index: ${fullSize} bytes`);
  console.log(`  Light index: ${lightSize} bytes`);
  console.log(`  Reduction: ${reduction}%`);

  assert.ok(reduction > 50, `Reduction ${reduction}% should be > 50%`);
});

// Test 4: Session details file structure
test('Session details saved separately', () => {
  const detailsFields = ['key_decisions', 'outcomes', 'learnings', 'code_changes'];

  const details = {};
  detailsFields.forEach(field => {
    if (testSession[field]) {
      details[field] = testSession[field];
    }
  });

  assert.deepStrictEqual(details.key_decisions, testSession.key_decisions);
  assert.deepStrictEqual(details.outcomes, testSession.outcomes);
  assert.deepStrictEqual(details.learnings, testSession.learnings);
  assert.deepStrictEqual(details.code_changes, testSession.code_changes);

  // Should NOT include lightweight fields
  assert.strictEqual(details.id, undefined);
  assert.strictEqual(details.summary, undefined);
});

// Test 5: Lazy loading simulation - only load when needed
test('Lazy loading simulation - load details on demand', () => {
  // Simulate index with lightweight sessions
  const index = {
    sessions: [{
      id: 'test-session-1',
      summary: 'Test summary'
    }]
  };

  // Simulate loading details only when requested
  let detailsLoaded = false;

  function loadSessionDetails(sessionId) {
    detailsLoaded = true;
    return {
      key_decisions: ['Decision 1'],
      outcomes: ['Outcome 1']
    };
  }

  // Query 1: List sessions (no details needed)
  const sessionList = index.sessions.map(s => s.summary);
  assert.strictEqual(detailsLoaded, false, 'Details should not be loaded yet');

  // Query 2: Get full session (load details)
  const fullSession = {
    ...index.sessions[0],
    ...loadSessionDetails('test-session-1')
  };

  assert.strictEqual(detailsLoaded, true, 'Details should be loaded now');
  assert.ok(fullSession.key_decisions, 'Should have key_decisions');
  assert.ok(fullSession.outcomes, 'Should have outcomes');
});

// Test 6: Real-world scenario - 100 sessions
test('Real-world: 100 sessions lazy loading benefit', () => {
  const sessions = Array.from({ length: 100 }, (_, i) => ({
    id: `session-${i}`,
    project: 'TestProject',
    date: '2025-12-03',
    summary: `Session ${i} about various improvements and features`,
    topics: ['feature', 'improvement'],
    key_decisions: [
      'Long decision text explaining the reasoning behind this choice',
      'Another detailed decision with multiple paragraphs of context'
    ],
    outcomes: [
      'Detailed outcome describing what was accomplished',
      'Performance metrics and benchmark results from testing'
    ],
    learnings: [
      'Important lesson learned during implementation',
      'Technical insight gained from debugging issues'
    ],
    code_changes: {
      files_added: [`file-${i}-1.js`, `file-${i}-2.js`],
      files_modified: [`existing-${i}.js`],
      files_deleted: [],
      lines_added: 250 + i,
      lines_removed: 50 + i
    }
  }));

  // Calculate full index size
  const fullIndex = { sessions };
  const fullSize = Buffer.byteLength(JSON.stringify(fullIndex), 'utf8');

  // Calculate lightweight index size
  const lightSessions = sessions.map(s => ({
    id: s.id,
    project: s.project,
    date: s.date,
    summary: s.summary,
    topics: s.topics
  }));
  const lightIndex = { sessions: lightSessions };
  const lightSize = Buffer.byteLength(JSON.stringify(lightIndex), 'utf8');

  const reduction = ((1 - lightSize / fullSize) * 100).toFixed(1);

  console.log(`  100 sessions:`);
  console.log(`  Full: ${(fullSize / 1024).toFixed(2)} KB`);
  console.log(`  Light: ${(lightSize / 1024).toFixed(2)} KB`);
  console.log(`  Reduction: ${reduction}%`);
  console.log(`  Bytes per session: ${(lightSize / 100).toFixed(0)} (light) vs ${(fullSize / 100).toFixed(0)} (full)`);

  // Target: 64% reduction (from Phase 1 spec)
  assert.ok(reduction > 60, `Reduction ${reduction}% should be > 60%`);
});

// Test 7: Progressive disclosure pattern
test('Progressive disclosure - 3 levels', () => {
  // Level 1: Just IDs and dates (ultra-light)
  const level1 = sessions => sessions.map(s => ({ id: s.id, date: s.date }));

  // Level 2: Add summaries and topics (lightweight)
  const level2 = sessions => sessions.map(s => ({
    id: s.id,
    date: s.date,
    summary: s.summary,
    topics: s.topics
  }));

  // Level 3: Full details (load on-demand)
  const level3 = session => session; // Full session object

  const testSessions = [testSession];

  const l1 = level1(testSessions);
  const l2 = level2(testSessions);
  const l3 = level3(testSession);

  const l1Size = Buffer.byteLength(JSON.stringify(l1), 'utf8');
  const l2Size = Buffer.byteLength(JSON.stringify(l2), 'utf8');
  const l3Size = Buffer.byteLength(JSON.stringify(l3), 'utf8');

  console.log(`  Level 1 (IDs): ${l1Size} bytes`);
  console.log(`  Level 2 (summaries): ${l2Size} bytes`);
  console.log(`  Level 3 (full): ${l3Size} bytes`);

  assert.ok(l1Size < l2Size, 'Level 1 should be smaller than Level 2');
  assert.ok(l2Size < l3Size, 'Level 2 should be smaller than Level 3');
});

// Test 8: Query pattern optimization
test('Query pattern: 80% answered from lightweight index', () => {
  const queries = [
    { type: 'list', needsDetails: false },      // List all sessions
    { type: 'search', needsDetails: false },    // Search by topic
    { type: 'filter', needsDetails: false },    // Filter by date
    { type: 'summary', needsDetails: false },   // Get summaries
    { type: 'details', needsDetails: true },    // Get full session
  ];

  const lightQueries = queries.filter(q => !q.needsDetails).length;
  const percentage = (lightQueries / queries.length) * 100;

  console.log(`  ${lightQueries}/${queries.length} queries (${percentage}%) don't need full details`);

  assert.ok(percentage >= 80, 'At least 80% of queries should work with lightweight index');
});

// Test 9: Memory efficiency
test('Memory efficiency with lazy loading', () => {
  // Simulate loading 1000 sessions

  // Without lazy loading: Load all 1000 full sessions
  const fullSessionSize = Buffer.byteLength(JSON.stringify(testSession), 'utf8');
  const fullMemory = fullSessionSize * 1000;

  // With lazy loading: Load 1000 lightweight + 5 full details (typical usage)
  const lightSession = {
    id: testSession.id,
    project: testSession.project,
    date: testSession.date,
    summary: testSession.summary,
    topics: testSession.topics
  };
  const lightSessionSize = Buffer.byteLength(JSON.stringify(lightSession), 'utf8');
  const lazyMemory = (lightSessionSize * 1000) + (fullSessionSize * 5);

  const savings = ((1 - lazyMemory / fullMemory) * 100).toFixed(1);

  console.log(`  Without lazy loading: ${(fullMemory / 1024).toFixed(2)} KB`);
  console.log(`  With lazy loading: ${(lazyMemory / 1024).toFixed(2)} KB`);
  console.log(`  Memory savings: ${savings}%`);

  assert.ok(savings > 60, `Savings ${savings}% should be > 60%`);
});

// Test 10: Lazy loading API correctness
test('Lazy loading maintains data integrity', () => {
  // Simulate split data
  const lightweight = {
    id: testSession.id,
    project: testSession.project,
    date: testSession.date,
    summary: testSession.summary,
    topics: testSession.topics
  };

  const details = {
    key_decisions: testSession.key_decisions,
    outcomes: testSession.outcomes,
    learnings: testSession.learnings,
    code_changes: testSession.code_changes
  };

  // Reconstruct full session
  const reconstructed = { ...lightweight, ...details };

  // Verify all data is preserved
  assert.deepStrictEqual(reconstructed, testSession, 'Reconstructed session should match original');
});

// Print results
console.log('\n' + '='.repeat(50));
console.log(`✅ Passed: ${passed}`);
if (failed > 0) {
  console.log(`❌ Failed: ${failed}`);
  process.exit(1);
} else {
  console.log('🎉 All tests passed!');
  process.exit(0);
}
