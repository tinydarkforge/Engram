#!/usr/bin/env node

/**
 * Deploy Neural Memory to all Claude instances
 *
 * This script:
 * 1. Generates project-specific CLAUDE.md files from Neural Memory
 * 2. Deploys them to all known repositories
 * 3. Sets up hooks for auto-refresh
 *
 * Usage:
 *   node deploy-neural.js              # Deploy to all repos
 *   node deploy-neural.js --list       # List target repos
 *   node deploy-neural.js --dry-run    # Show what would be deployed
 */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const msgpack = require('msgpack-lite');

const MEMEX_PATH = process.env.MEMEX_PATH || path.join(process.env.HOME, 'code/cirrus/DevOps/Memex');
const NEURAL_PATH = path.join(MEMEX_PATH, '.neural');
const REDACTED_PATH = path.join(process.env.HOME, 'code/cirrus');

// Known repositories to deploy to
const REPO_MAP = {
  'DemoProject': path.join(REDACTED_PATH, 'DemoProject'),
  'translate.REDACTED': path.join(REDACTED_PATH, 'translateREDACTED'),
  'DevOps': path.join(REDACTED_PATH, 'DevOps'),
  'Memex': path.join(REDACTED_PATH, 'DevOps/Memex'),
  'REDACTED': path.join(REDACTED_PATH, 'REDACTED'),
  'ProjectB': path.join(REDACTED_PATH, 'ProjectB')
};

class NeuralDeployer {
  constructor() {
    this.slimContext = null;
    this.bundles = {};
  }

  /**
   * Load Neural Memory data
   */
  load() {
    // Load slim context
    const slimPath = path.join(MEMEX_PATH, 'slim-context.json');
    if (fs.existsSync(slimPath)) {
      this.slimContext = JSON.parse(fs.readFileSync(slimPath, 'utf8'));
    }

    // Load bundles
    const bundlesDir = path.join(NEURAL_PATH, 'bundles');
    if (fs.existsSync(bundlesDir)) {
      for (const file of fs.readdirSync(bundlesDir)) {
        if (file.endsWith('.msgpack')) {
          const name = file.replace('.msgpack', '');
          const buffer = fs.readFileSync(path.join(bundlesDir, file));
          this.bundles[name] = msgpack.decode(buffer);
        }
      }
    }
  }

  /**
   * Generate CLAUDE.md content for a project
   */
  generateClaudeMd(projectName, repoPath) {
    const bundle = this.bundles[projectName];
    const project = this.slimContext?.projects?.[projectName];

    // Use bundle if available, fall back to slim context
    const desc = bundle?.d || project?.desc || 'Project';
    const tech = bundle?.t || project?.tech || '';
    const deploy = bundle?.dp || project?.deploy || {};
    const env = bundle?.e || project?.env || {};
    const recent = bundle?.r || this.slimContext?.recent?.[projectName] || [];
    const concepts = bundle?.c || [];

    const md = `# Neural Memory Context

> Auto-generated. Do not edit. Regenerate with: \`node ~/code/cirrus/DevOps/Memex/scripts/deploy-neural.js\`

## Quick Refs
- **Commit:** \`<type>(<scope>): <description>\` (feat|fix|docs|style|refactor|test|chore)
- **PR:** tests + self-review + lint + typecheck + build + 1 approval
- **Branches:** main→staging→develop→feature/*

## ${projectName}
- **About:** ${desc}
- **Tech:** ${tech}
${env.dev ? `- **Dev:** ${env.dev}` : ''}
${env.stg ? `- **Staging:** ${env.stg}` : ''}
${env.prd ? `- **Prod:** ${env.prd}` : ''}
${deploy.stg ? `- **Deploy STG:** \`${deploy.stg}\`` : ''}
${deploy.prd ? `- **Deploy PRD:** \`${deploy.prd}\`` : ''}

## Recent (from Neural Memory)
${recent.length > 0 ? recent.map(r => `- ${r.d}: ${r.s}`).join('\n') : '(no recent sessions)'}

## Key Concepts
${concepts.length > 0 ? concepts.join(', ') : '(run neural-memory.js build)'}

## Deep Queries
\`\`\`bash
# Semantic search (finds by meaning)
node ~/code/cirrus/DevOps/Memex/scripts/neural-memory.js query "your question"

# Get full context
node ~/code/cirrus/DevOps/Memex/scripts/neural-memory.js bundle ${projectName}
\`\`\`

## Save Session
\`\`\`bash
~/code/cirrus/DevOps/Memex/scripts/remember "what you did" --topics tag1,tag2
\`\`\`

---
*Neural Memory v1.0 | ${new Date().toISOString().split('T')[0]}*
`;

    return md;
  }

  /**
   * Generate generic CLAUDE.md for unknown projects
   */
  generateGenericClaudeMd(repoName) {
    return `# Neural Memory Context

> Auto-generated. Regenerate: \`node ~/code/cirrus/DevOps/Memex/scripts/deploy-neural.js\`

## Quick Refs
- **Commit:** \`<type>(<scope>): <description>\` (feat|fix|docs|style|refactor|test|chore)
- **PR:** tests + self-review + lint + typecheck + build + 1 approval
- **Branches:** main→staging→develop→feature/*

## ${repoName}
This project is not yet indexed in Neural Memory.

To add it:
\`\`\`bash
# Save a session to register this project
cd ${REPO_MAP[repoName] || '/path/to/repo'}
~/code/cirrus/DevOps/Memex/scripts/remember "Initial session" --topics ${repoName.toLowerCase()}

# Rebuild neural memory
node ~/code/cirrus/DevOps/Memex/scripts/neural-memory.js build
node ~/code/cirrus/DevOps/Memex/scripts/deploy-neural.js
\`\`\`

## Deep Queries
\`\`\`bash
node ~/code/cirrus/DevOps/Memex/scripts/neural-memory.js query "your question"
\`\`\`

---
*Neural Memory v1.0 | ${new Date().toISOString().split('T')[0]}*
`;
  }

  /**
   * Deploy to all repositories
   */
  deploy(options = {}) {
    const { dryRun = false, verbose = true } = options;
    this.load();

    const results = [];

    for (const [projectName, repoPath] of Object.entries(REPO_MAP)) {
      if (!fs.existsSync(repoPath)) {
        results.push({ project: projectName, status: 'skipped', reason: 'repo not found' });
        continue;
      }

      const claudeDir = path.join(repoPath, '.claude');
      const claudeMdPath = path.join(claudeDir, 'CLAUDE.md');

      // Generate content
      const content = this.bundles[projectName]
        ? this.generateClaudeMd(projectName, repoPath)
        : this.generateGenericClaudeMd(projectName);

      if (dryRun) {
        results.push({
          project: projectName,
          status: 'dry-run',
          path: claudeMdPath,
          size: content.length
        });
        if (verbose) {
          console.log(`[DRY-RUN] Would write ${content.length} bytes to ${claudeMdPath}`);
        }
        continue;
      }

      // Ensure .claude directory exists
      if (!fs.existsSync(claudeDir)) {
        fs.mkdirSync(claudeDir, { recursive: true });
      }

      // Write CLAUDE.md
      fs.writeFileSync(claudeMdPath, content);

      results.push({
        project: projectName,
        status: 'deployed',
        path: claudeMdPath,
        size: content.length
      });

      if (verbose) {
        console.log(`✅ ${projectName}: ${claudeMdPath} (${content.length} bytes)`);
      }
    }

    return results;
  }

  /**
   * List target repositories
   */
  list() {
    this.load();

    console.log('Target repositories:\n');
    for (const [projectName, repoPath] of Object.entries(REPO_MAP)) {
      const exists = fs.existsSync(repoPath);
      const hasBundle = !!this.bundles[projectName];
      const status = exists
        ? (hasBundle ? '✅ indexed' : '⚠️  not indexed')
        : '❌ not found';

      console.log(`  ${projectName}`);
      console.log(`    Path: ${repoPath}`);
      console.log(`    Status: ${status}`);
      console.log('');
    }
  }

  /**
   * Create hooks for auto-refresh
   */
  setupHooks() {
    // Create a post-commit hook that rebuilds neural memory
    const hookScript = `#!/bin/bash
# Auto-update Neural Memory on significant commits
# Installed by deploy-neural.js

MEMEX_PATH="${MEMEX_PATH}"

# Only run on main/develop branches
BRANCH=$(git rev-parse --abbrev-ref HEAD)
if [[ "$BRANCH" == "main" || "$BRANCH" == "develop" || "$BRANCH" == "master" ]]; then
  # Rebuild in background (non-blocking)
  (cd "$MEMEX_PATH" && node scripts/neural-memory.js build > /dev/null 2>&1) &
fi
`;

    const hookPath = path.join(MEMEX_PATH, 'scripts', 'neural-post-commit.sh');
    fs.writeFileSync(hookPath, hookScript);
    fs.chmodSync(hookPath, '755');

    console.log(`✅ Created hook: ${hookPath}`);
    console.log('\nTo enable auto-rebuild in a repo:');
    console.log(`  ln -sf ${hookPath} /path/to/repo/.git/hooks/post-commit`);

    return hookPath;
  }
}

// CLI
const args = process.argv.slice(2);
const deployer = new NeuralDeployer();

if (args.includes('--list')) {
  deployer.list();
} else if (args.includes('--dry-run')) {
  console.log('🔍 Dry run - no files will be written\n');
  deployer.deploy({ dryRun: true });
} else if (args.includes('--hooks')) {
  deployer.setupHooks();
} else if (args.includes('--help')) {
  console.log(`
Deploy Neural Memory to all Claude instances

Usage:
  node deploy-neural.js                    Deploy to all repositories
  node deploy-neural.js --project <name>   Deploy to single project
  node deploy-neural.js --list             List target repositories
  node deploy-neural.js --dry-run          Show what would be deployed
  node deploy-neural.js --hooks            Setup auto-refresh hooks
  node deploy-neural.js --quiet            Suppress output (for hooks)

This deploys CLAUDE.md files containing:
- Quick refs (commit format, PR requirements)
- Project-specific context from Neural Memory
- Recent sessions and key concepts
- Commands for deep queries
`);
} else if (args.includes('--project')) {
  const projectIdx = args.indexOf('--project');
  const projectName = args[projectIdx + 1];
  const quiet = args.includes('--quiet');

  if (!projectName) {
    console.error('Usage: deploy-neural.js --project <name>');
    process.exit(1);
  }

  deployer.load();
  const repoPath = REPO_MAP[projectName];

  if (!repoPath) {
    if (!quiet) console.error(`Unknown project: ${projectName}`);
    process.exit(1);
  }

  const content = deployer.bundles[projectName]
    ? deployer.generateClaudeMd(projectName, repoPath)
    : deployer.generateGenericClaudeMd(projectName);

  const claudeDir = path.join(repoPath, '.claude');
  const claudeMdPath = path.join(claudeDir, 'CLAUDE.md');

  if (!fs.existsSync(claudeDir)) {
    fs.mkdirSync(claudeDir, { recursive: true });
  }

  fs.writeFileSync(claudeMdPath, content);
  if (!quiet) console.log(`✅ ${projectName}: ${claudeMdPath} (${content.length} bytes)`);
} else {
  const quiet = args.includes('--quiet');
  if (!quiet) console.log('🚀 Deploying Neural Memory to all repositories...\n');
  const results = deployer.deploy({ verbose: !quiet });

  const deployed = results.filter(r => r.status === 'deployed').length;
  const skipped = results.filter(r => r.status === 'skipped').length;

  if (!quiet) console.log(`\n✅ Deployed: ${deployed} | Skipped: ${skipped}`);
}
