#!/usr/bin/env node

/**
 * CLI Utilities - Pretty output helpers for Memex scripts
 *
 * Usage:
 *   const cli = require('./cli-utils');
 *   cli.header('Neural Memory');
 *   cli.success('Done!');
 *   cli.table(data, ['Column1', 'Column2']);
 */

const chalk = require('chalk');

// ─────────────────────────────────────────────────────────────
// Colors & Styles
// ─────────────────────────────────────────────────────────────

const colors = {
  primary: chalk.hex('#58a6ff'),      // Blue accent
  success: chalk.hex('#3fb950'),      // Green
  warning: chalk.hex('#d29922'),      // Yellow/orange
  error: chalk.hex('#f85149'),        // Red
  muted: chalk.hex('#8b949e'),        // Gray
  hot: chalk.hex('#e74c3c'),          // Hot red
  warm: chalk.hex('#f39c12'),         // Warm orange
  normal: chalk.hex('#3498db'),       // Normal blue
  cold: chalk.hex('#95a5a6'),         // Cold gray
};

const icons = {
  success: '✓',
  error: '✗',
  warning: '⚠',
  info: 'ℹ',
  bullet: '•',
  arrow: '→',
  brain: '🧠',
  search: '🔍',
  package: '📦',
  graph: '🔗',
  stats: '📊',
  build: '🔨',
  time: '⏱',
};

// ─────────────────────────────────────────────────────────────
// Output Functions
// ─────────────────────────────────────────────────────────────

/**
 * Print a styled header
 */
function header(text, icon = icons.brain) {
  console.log();
  console.log(chalk.bold(`${icon} ${colors.primary(text)}`));
  console.log(colors.muted('─'.repeat(50)));
}

/**
 * Print a section header
 */
function section(text, icon = icons.bullet) {
  console.log();
  console.log(chalk.bold(`${icon} ${text}`));
}

/**
 * Print success message
 */
function success(text) {
  console.log(colors.success(`${icons.success} ${text}`));
}

/**
 * Print error message
 */
function error(text) {
  console.log(colors.error(`${icons.error} ${text}`));
}

/**
 * Print warning message
 */
function warning(text) {
  console.log(colors.warning(`${icons.warning} ${text}`));
}

/**
 * Print info message
 */
function info(text) {
  console.log(colors.muted(`${icons.info} ${text}`));
}

/**
 * Print a key-value pair
 */
function keyValue(key, value, indent = 0) {
  const pad = ' '.repeat(indent);
  console.log(`${pad}${colors.muted(key + ':')} ${value}`);
}

/**
 * Print indented line
 */
function indent(text, level = 1) {
  console.log(' '.repeat(level * 2) + text);
}

/**
 * Print a progress step
 */
function step(num, text) {
  const stepNum = colors.primary(`[${num}]`);
  console.log(`${stepNum} ${text}`);
}

// ─────────────────────────────────────────────────────────────
// Tables
// ─────────────────────────────────────────────────────────────

/**
 * Print a formatted table
 *
 * @param {Array<Object>} data - Array of row objects
 * @param {Array<{key: string, label: string, width?: number, align?: string}>} columns
 */
function table(data, columns) {
  if (!data || data.length === 0) {
    info('No data');
    return;
  }

  // Calculate column widths
  const colWidths = columns.map(col => {
    if (col.width) return col.width;
    const maxData = Math.max(...data.map(row => String(row[col.key] || '').length));
    return Math.max(col.label.length, maxData);
  });

  // Header
  const headerRow = columns.map((col, i) => {
    return colors.muted(col.label.padEnd(colWidths[i]));
  }).join('  ');
  console.log(headerRow);

  // Separator
  console.log(colors.muted(colWidths.map(w => '─'.repeat(w)).join('──')));

  // Rows
  for (const row of data) {
    const rowStr = columns.map((col, i) => {
      let val = String(row[col.key] ?? '');
      if (col.align === 'right') {
        val = val.padStart(colWidths[i]);
      } else {
        val = val.padEnd(colWidths[i]);
      }

      // Apply color if specified
      if (col.color) {
        val = col.color(val);
      }
      return val;
    }).join('  ');
    console.log(rowStr);
  }
}

/**
 * Print a simple two-column table
 */
function simpleTable(rows, col1Width = 25) {
  for (const [key, value] of rows) {
    console.log(`  ${colors.muted(String(key).padEnd(col1Width))} ${value}`);
  }
}

// ─────────────────────────────────────────────────────────────
// Stats & Metrics
// ─────────────────────────────────────────────────────────────

/**
 * Print a stats box
 */
function stats(data) {
  const maxKeyLen = Math.max(...Object.keys(data).map(k => k.length));

  for (const [key, value] of Object.entries(data)) {
    const formattedValue = typeof value === 'number'
      ? colors.primary(value.toLocaleString())
      : value;
    console.log(`  ${key.padEnd(maxKeyLen)}  ${formattedValue}`);
  }
}

/**
 * Print a progress bar
 */
function progressBar(current, total, width = 30) {
  const pct = Math.round((current / total) * 100);
  const filled = Math.round((current / total) * width);
  const empty = width - filled;

  const bar = colors.primary('█'.repeat(filled)) + colors.muted('░'.repeat(empty));
  process.stdout.write(`\r  ${bar} ${pct}% (${current}/${total})`);

  if (current >= total) console.log();
}

// ─────────────────────────────────────────────────────────────
// Topics & Tags
// ─────────────────────────────────────────────────────────────

/**
 * Format a topic tag with heat coloring
 */
function topicTag(name, count) {
  let color;
  if (count >= 5) color = colors.hot;
  else if (count >= 3) color = colors.warm;
  else if (count >= 2) color = colors.normal;
  else color = colors.cold;

  return color(name);
}

/**
 * Print topics as a colored list
 */
function topicList(topics, showCount = true) {
  for (const t of topics) {
    const name = t.name || t.term || t;
    const count = t.sessions || t.score || t.count || 0;
    const tag = topicTag(name, count);

    if (showCount && count) {
      console.log(`  ${tag} ${colors.muted(`(${count})`)}`);
    } else {
      console.log(`  ${tag}`);
    }
  }
}

// ─────────────────────────────────────────────────────────────
// Sessions
// ─────────────────────────────────────────────────────────────

/**
 * Print a session item
 */
function sessionItem(session, showProject = true) {
  const date = colors.muted(session.date || '');
  const project = showProject ? colors.primary(session.project || '') + ' ' : '';
  const summary = session.summary || session.text_preview || session.id;

  console.log(`  ${date} ${project}${summary}`);

  if (session.topics && session.topics.length > 0) {
    const tags = session.topics.slice(0, 5).map(t => colors.muted(t)).join(', ');
    console.log(`           ${tags}`);
  }
}

// ─────────────────────────────────────────────────────────────
// Search Results
// ─────────────────────────────────────────────────────────────

/**
 * Print search results
 */
function searchResults(results, query) {
  header(`Search: "${query}"`, icons.search);

  if (!results || results.length === 0) {
    info('No results found');
    return;
  }

  console.log(colors.muted(`Found ${results.length} results\n`));

  for (const r of results) {
    const score = r.score !== undefined
      ? colors.primary(`${(r.score * 100).toFixed(0)}%`)
      : '';
    const decay = r.decay !== undefined && r.decay < 1
      ? colors.muted(` (decay: ${(r.decay * 100).toFixed(0)}%)`)
      : '';

    console.log(`${score}${decay} ${r.summary || r.text_preview || r.session_id}`);

    if (r.topics && r.topics.length > 0) {
      const tags = r.topics.slice(0, 4).map(t => colors.muted(t)).join(', ');
      console.log(`     ${tags}`);
    }
    console.log();
  }
}

// ─────────────────────────────────────────────────────────────
// Exports
// ─────────────────────────────────────────────────────────────

module.exports = {
  // Colors
  colors,
  icons,

  // Basic output
  header,
  section,
  success,
  error,
  warning,
  info,
  keyValue,
  indent,
  step,

  // Tables
  table,
  simpleTable,

  // Stats
  stats,
  progressBar,

  // Topics
  topicTag,
  topicList,

  // Sessions
  sessionItem,

  // Search
  searchResults,

  // Chalk re-export for custom styling
  chalk,
};
