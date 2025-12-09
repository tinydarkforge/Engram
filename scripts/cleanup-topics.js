#!/usr/bin/env node

/**
 * Cleanup empty topics from sessions
 *
 * Usage:
 *   node cleanup-topics.js scan     # Find empty topics
 *   node cleanup-topics.js fix      # Remove empty topics
 */

const fs = require('fs');
const path = require('path');
const cli = require('./cli-utils');

const MEMEX_PATH = process.env.MEMEX_PATH || path.join(process.env.HOME, 'code/cirrus/DevOps/Memex');
const projectsDir = path.join(MEMEX_PATH, 'summaries/projects');

function scan() {
  cli.header('Scan for Empty Topics', cli.icons.search);

  let totalEmpty = 0;
  let sessionsWithEmpty = [];

  for (const proj of fs.readdirSync(projectsDir)) {
    const indexPath = path.join(projectsDir, proj, 'sessions-index.json');
    if (!fs.existsSync(indexPath)) continue;

    const data = JSON.parse(fs.readFileSync(indexPath, 'utf8'));
    for (const s of data.sessions || []) {
      const emptyCount = (s.topics || []).filter(t => !t || t.trim() === '').length;
      if (emptyCount > 0) {
        totalEmpty += emptyCount;
        sessionsWithEmpty.push({
          project: proj,
          id: s.id,
          topics: s.topics,
          emptyCount
        });
      }
    }
  }

  cli.stats({
    'Sessions with empty topics': sessionsWithEmpty.length,
    'Total empty entries': totalEmpty
  });

  if (sessionsWithEmpty.length > 0) {
    cli.section('Affected Sessions');
    sessionsWithEmpty.forEach(s => {
      const topicsStr = s.topics.map(t => t || cli.colors.error('""')).join(', ');
      cli.indent(`${cli.colors.primary(s.project)}/${s.id}: [${topicsStr}]`);
    });
  }

  return { sessionsWithEmpty, totalEmpty };
}

function fix() {
  cli.header('Fix Empty Topics', cli.icons.build);

  let fixed = 0;
  let filesModified = 0;

  for (const proj of fs.readdirSync(projectsDir)) {
    const indexPath = path.join(projectsDir, proj, 'sessions-index.json');
    if (!fs.existsSync(indexPath)) continue;

    const data = JSON.parse(fs.readFileSync(indexPath, 'utf8'));
    let modified = false;

    for (const s of data.sessions || []) {
      const originalLength = (s.topics || []).length;
      s.topics = (s.topics || []).filter(t => t && t.trim() !== '');

      if (s.topics.length < originalLength) {
        fixed += originalLength - s.topics.length;
        modified = true;
      }
    }

    if (modified) {
      fs.writeFileSync(indexPath, JSON.stringify(data, null, 2));
      filesModified++;
      cli.success(`${proj}: cleaned sessions-index.json`);
    }
  }

  // Also clean index.json topics
  const indexPath = path.join(MEMEX_PATH, 'index.json');
  if (fs.existsSync(indexPath)) {
    const index = JSON.parse(fs.readFileSync(indexPath, 'utf8'));

    if (index.t && index.t['']) {
      delete index.t[''];
      fs.writeFileSync(indexPath, JSON.stringify(index, null, 2));
      cli.success('Removed empty topic from index.json');
    }
  }

  console.log();
  cli.success(`Fixed ${fixed} empty topics in ${filesModified} files`);
  return { fixed, filesModified };
}

function consolidate() {
  cli.header('Consolidate Topics', cli.icons.graph);

  const indexPath = path.join(MEMEX_PATH, 'index.json');
  const index = JSON.parse(fs.readFileSync(indexPath, 'utf8'));

  // Find topics with 0 sessions (orphaned)
  const orphaned = Object.entries(index.t).filter(([k, v]) => v.sc === 0 && k);

  // Remove orphaned topics
  let removed = 0;
  for (const [topic] of orphaned) {
    delete index.t[topic];
    removed++;
  }

  if (removed > 0) {
    cli.warning(`Removed ${removed} orphaned topics (0 sessions)`);
  }

  // Consolidate PR/issue/epic topics into categories
  const consolidationMap = {
    'pr-': 'pull-requests',
    'issue-': 'issues',
    'epic-': 'epics'
  };

  let consolidated = 0;
  for (const [prefix, target] of Object.entries(consolidationMap)) {
    const matching = Object.entries(index.t).filter(([k]) => k.startsWith(prefix));

    if (matching.length > 1) {
      // Create or update target topic
      if (!index.t[target]) {
        index.t[target] = { p: [], sc: 0 };
      }

      for (const [topic, data] of matching) {
        // Merge projects
        for (const p of data.p) {
          if (!index.t[target].p.includes(p)) {
            index.t[target].p.push(p);
          }
        }
        index.t[target].sc += data.sc;

        // Remove old topic
        delete index.t[topic];
        consolidated++;
      }

      cli.info(`Consolidated ${matching.length} ${prefix}* topics into '${target}'`);
    }
  }

  // Save
  fs.writeFileSync(indexPath, JSON.stringify(index, null, 2));

  const remaining = Object.keys(index.t).length;
  console.log();
  cli.success(`Topics: ${remaining} remaining (removed ${removed}, consolidated ${consolidated})`);

  return { removed, consolidated, remaining };
}

function stats() {
  cli.header('Topic Statistics', cli.icons.stats);

  const indexPath = path.join(MEMEX_PATH, 'index.json');
  const index = JSON.parse(fs.readFileSync(indexPath, 'utf8'));

  const topics = Object.entries(index.t);
  const byCount = topics.reduce((acc, [k, v]) => {
    const bucket = v.sc === 0 ? '0' : v.sc === 1 ? '1' : v.sc <= 5 ? '2-5' : '5+';
    acc[bucket] = (acc[bucket] || 0) + 1;
    return acc;
  }, {});

  cli.keyValue('Total topics', topics.length);

  cli.section('By Session Count');
  cli.simpleTable([
    ['0 (orphaned)', byCount['0'] || 0],
    ['1 session', byCount['1'] || 0],
    ['2-5 sessions', byCount['2-5'] || 0],
    ['5+ sessions', byCount['5+'] || 0]
  ], 16);

  cli.section('Top 10 Topics');
  const topTopics = topics.sort((a, b) => b[1].sc - a[1].sc).slice(0, 10).map(([k, v]) => ({
    topic: cli.topicTag(k, v.sc),
    sessions: v.sc
  }));
  cli.table(topTopics, [
    { key: 'topic', label: 'Topic', width: 22 },
    { key: 'sessions', label: 'Sessions', width: 10, align: 'right' }
  ]);
}

// CLI
const command = process.argv[2];

switch (command) {
  case 'scan':
    scan();
    break;
  case 'fix':
    const before = scan();
    if (before.totalEmpty > 0) {
      console.log();
      fix();
    } else {
      cli.success('No empty topics to fix!');
    }
    break;
  case 'consolidate':
    consolidate();
    break;
  case 'stats':
    stats();
    break;
  case 'all':
    scan();
    fix();
    consolidate();
    stats();
    break;
  default:
    cli.header('Cleanup Topics');
    console.log(cli.colors.muted('Maintain topic hygiene\n'));
    cli.simpleTable([
      ['scan', 'Find empty topics in sessions'],
      ['fix', 'Remove empty topics from sessions'],
      ['consolidate', 'Merge low-value topics'],
      ['stats', 'Show topic statistics'],
      ['all', 'Run all cleanup steps']
    ], 14);
}
