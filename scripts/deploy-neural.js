#!/usr/bin/env node

/**
 * Deploy CLAUDE.md to all repos
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

const CIRRUS_PATH = path.join(process.env.HOME, 'code/cirrus');

// Repos to deploy to
const REPOS = {
  'CirrusTranslate': path.join(CIRRUS_PATH, 'CirrusTranslate'),
  'translate.hellocirrus': path.join(CIRRUS_PATH, 'translatehellocirrus'),
  'DevOps': path.join(CIRRUS_PATH, 'DevOps'),
  'Memex': path.join(CIRRUS_PATH, 'DevOps/Memex'),
  'MIRAGE': path.join(CIRRUS_PATH, 'MIRAGE'),
  'Aither': path.join(CIRRUS_PATH, 'Aither'),
  'CLEAR-Render': path.join(CIRRUS_PATH, 'CLEAR-Render'),
  'FORGE': path.join(CIRRUS_PATH, 'FORGE')
};

function generateClaudeMd(projectName) {
  const date = new Date().toISOString().split('T')[0];

  return `# ${projectName} Context

## Standards
- **Commit:** \`<type>(<scope>): <description>\` (feat|fix|docs|style|refactor|test|chore)
- **PR:** tests + self-review + lint + typecheck + build + 1 approval
- **Branches:** feature/, fix/, hotfix/, release/, chore/, docs/

## GitHub Issues
- Assign to Pamperito74, move to "In Progress" when starting
- Move to "Done", update \`docs/monthly/<MONTH>_<YEAR>.md\` when complete

## Commands
\`\`\`bash
# Search git history (semantic)
node ~/code/cirrus/DevOps/Memex/scripts/neural-memory.js search "your question"

# Save session note
~/code/cirrus/DevOps/Memex/scripts/remember "what you did" --topics tag1,tag2
\`\`\`

---
*Generated ${date}*
`;
}

function deploy() {
  console.log('🚀 Deploying CLAUDE.md to all repos...\n');

  let deployed = 0;
  let skipped = 0;

  for (const [name, repoPath] of Object.entries(REPOS)) {
    if (!fs.existsSync(repoPath)) {
      console.log(`⏭️  ${name}: repo not found`);
      skipped++;
      continue;
    }

    const claudeDir = path.join(repoPath, '.claude');
    const claudeMdPath = path.join(claudeDir, 'CLAUDE.md');

    if (!fs.existsSync(claudeDir)) {
      fs.mkdirSync(claudeDir, { recursive: true });
    }

    const content = generateClaudeMd(name);
    fs.writeFileSync(claudeMdPath, content);

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
Deploy CLAUDE.md to all repos

Usage:
  node deploy-neural.js        Deploy to all repos
  node deploy-neural.js --list List target repos
`);
} else {
  deploy();
}
