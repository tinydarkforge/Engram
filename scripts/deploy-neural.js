#!/usr/bin/env node

/**
 * Deploy AGENTS.md to all repos
 *
 * Simple deployment - just the essentials:
 * - Standards (commit format, PR requirements)
 * - Git search command
 * - Remember command
 *
 * Usage:
 *   node deploy-neural.js           # Deploy to all repos
 *   node deploy-neural.js --list    # List repos
 */

const fs = require('fs');
const path = require('path');
const { resolveMemexPath, resolveReposRoot } = require('./paths');
const { readJSON } = require('./safe-json');

const MEMEX_PATH = resolveMemexPath(__dirname);
const REPOS_ROOT = resolveReposRoot(MEMEX_PATH);

function discoverRepos() {
  const indexPath = path.join(MEMEX_PATH, 'index.json');
  const index = readJSON(indexPath);
  if (!index) return {};
  const repos = {};

  for (const projectName of Object.keys(index.p || {})) {
    const candidates = [
      path.join(REPOS_ROOT, projectName),
      path.join(REPOS_ROOT, projectName.replace(/\./g, '')),
      path.join(REPOS_ROOT, projectName.toLowerCase()),
    ];

    const repoPath = candidates.find(p => fs.existsSync(path.join(p, '.git')));
    if (repoPath) {
      repos[projectName] = repoPath;
    }
  }

  return repos;
}

const REPOS = discoverRepos();

function generateAgentsMd(projectName) {
  const date = new Date().toISOString().split('T')[0];

  return `# ${projectName} Context

## Standards
- **Commit:** \`<type>(<scope>): <description>\` (feat|fix|docs|style|refactor|test|chore)
- **PR:** tests + self-review + lint + typecheck + build + 1 approval
- **Branches:** feature/, fix/, hotfix/, release/, chore/, docs/

## GitHub Issues
- Assign an owner and move to \`In Progress\` when starting
- Move to \`Done\`, update project changelog/monthly notes when complete

## Commands
\`\`\`bash
# Search git history (semantic)
node ${MEMEX_PATH}/scripts/neural-memory.js search "your question"

# Save session note
${MEMEX_PATH}/scripts/remember "what you did" --topics tag1,tag2
\`\`\`

---
*Generated ${date}*
`;
}

function deploy() {
  console.log('🚀 Deploying AGENTS.md to discovered repos...\n');

  let deployed = 0;
  let skipped = 0;

  for (const [name, repoPath] of Object.entries(REPOS)) {
    if (!fs.existsSync(repoPath)) {
      console.log(`⏭️  ${name}: repo not found`);
      skipped++;
      continue;
    }

    const agentsMdPath = path.join(repoPath, 'AGENTS.md');
    const content = generateAgentsMd(name);
    fs.writeFileSync(agentsMdPath, content);

    console.log(`✅ ${name}`);
    deployed++;
  }

  console.log(`\nDone: ${deployed} deployed, ${skipped} skipped`);
}

function list() {
  console.log('Target repos:\n');
  for (const [name, repoPath] of Object.entries(REPOS)) {
    const exists = fs.existsSync(repoPath);
    console.log(`  ${exists ? '✅' : '❌'} ${name}: ${repoPath}`);
  }
}

// CLI
const args = process.argv.slice(2);

if (args.includes('--list')) {
  list();
} else if (args.includes('--help')) {
  console.log(`
Deploy AGENTS.md to discovered repos

Usage:
  node deploy-neural.js        Deploy AGENTS.md to all repos
  node deploy-neural.js --list List target repos
`);
} else {
  deploy();
}
