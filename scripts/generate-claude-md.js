#!/usr/bin/env node

/**
 * Generate CLAUDE.md for any project from Memex slim context
 *
 * Usage:
 *   node generate-claude-md.js CirrusTranslate    # Generate for specific project
 *   node generate-claude-md.js --all              # Generate for all known projects
 */

const fs = require('fs');
const path = require('path');

const MEMEX_PATH = process.env.MEMEX_PATH || path.join(process.env.HOME, 'code/cirrus/DevOps/Memex');
const SLIM_CONTEXT = path.join(MEMEX_PATH, 'slim-context.json');

function generateClaudeMd(projectName) {
  if (!fs.existsSync(SLIM_CONTEXT)) {
    console.error('Error: Run "node slim-context.js generate" first');
    process.exit(1);
  }

  const context = JSON.parse(fs.readFileSync(SLIM_CONTEXT, 'utf8'));
  const project = context.projects[projectName];

  if (!project) {
    console.error(`Project "${projectName}" not found in Memex`);
    console.log('Available:', Object.keys(context.projects).join(', '));
    process.exit(1);
  }

  const recent = context.recent[projectName] || [];
  const recentStr = recent.length > 0
    ? recent.map(s => `- ${s.d}: ${s.s}`).join('\n')
    : '(no recent sessions)';

  const md = `# Quick Context (Memex v1.0)

## Standards
- **Commit:** \`<type>(<scope>): <description>\` (feat|fix|docs|style|refactor|test|chore)
- **PR:** tests + self-review + lint + typecheck + build + 1 approval
- **Branches:** main(prod) → staging(QA) → develop(dev) → feature/*

## ${projectName}
- **About:** ${project.desc}
- **Tech:** ${project.tech}
${project.env ? `- **Envs:** dev=${project.env.dev || 'n/a'} | stg=${project.env.stg || 'n/a'} | prd=${project.env.prd || 'n/a'}` : ''}
${project.deploy?.stg ? `- **Deploy staging:** \`${project.deploy.stg}\`` : ''}
${project.deploy?.prd ? `- **Deploy prod:** \`${project.deploy.prd}\`` : ''}

## Recent Work
${recentStr}

## Deep Queries
\`\`\`bash
node ~/code/cirrus/DevOps/Memex/scripts/memex-loader.js quick "<query>"
\`\`\`

---
*Token-optimized. Full Memex: ~/code/cirrus/DevOps/Memex*
`;

  return md;
}

// CLI
const arg = process.argv[2];

if (!arg) {
  console.log(`
Generate CLAUDE.md for projects

Usage:
  node generate-claude-md.js <ProjectName>   Generate for specific project
  node generate-claude-md.js --all           Generate for all projects
  node generate-claude-md.js --list          List available projects
`);
  process.exit(0);
}

if (arg === '--list') {
  const context = JSON.parse(fs.readFileSync(SLIM_CONTEXT, 'utf8'));
  console.log('Available projects:');
  for (const [name, proj] of Object.entries(context.projects)) {
    console.log(`  ${name} - ${proj.desc.slice(0, 50)}...`);
  }
  process.exit(0);
}

if (arg === '--all') {
  const context = JSON.parse(fs.readFileSync(SLIM_CONTEXT, 'utf8'));
  for (const projectName of Object.keys(context.projects)) {
    const md = generateClaudeMd(projectName);
    const outPath = path.join(MEMEX_PATH, `templates/CLAUDE-${projectName}.md`);
    fs.writeFileSync(outPath, md);
    console.log(`✅ ${outPath} (${md.length} bytes)`);
  }
} else {
  const md = generateClaudeMd(arg);
  console.log(md);
  console.log(`\n--- Size: ${md.length} bytes ---`);
}
