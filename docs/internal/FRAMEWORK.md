# TinyDarkForge Development Framework

A complete, repeatable system for going from idea to shipped product.
Built for a 2-person team that builds with AI coding assistants.

---

## Table of Contents

1. [Phase 1: Idea to Spec](#phase-1-idea-to-spec)
2. [Phase 2: Tech Decision Tree](#phase-2-tech-decision-tree)
3. [Phase 3: Project Scaffold](#phase-3-project-scaffold)
4. [Phase 4: Development Flow](#phase-4-development-flow)
5. [Phase 5: AI-Optimized Workflow](#phase-5-ai-optimized-workflow)
6. [Phase 6: Project Board](#phase-6-project-board)
7. [Phase 7: Quality Gates](#phase-7-quality-gates)
8. [Appendix A: Templates](#appendix-a-templates)
9. [Appendix B: Stack Reference](#appendix-b-stack-reference)

---

## Phase 1: Idea to Spec

Every project starts with answering 12 questions. Copy this checklist into a
new file called `SPEC.md` at the root of the repo. Fill it in before writing
any code.

### The 12 Questions

```markdown
# SPEC: [Project Name]

## 1. One-Liner
What does this do in one sentence?
>

## 2. Who Is It For?
Who uses this? (Be specific: "plumbers who need invoicing", not "small businesses")
>

## 3. What Problem Does It Solve?
What pain exists today that this eliminates?
>

## 4. Core Actions (max 5)
What are the 3-5 things a user DOES in this product?
> 1.
> 2.
> 3.

## 5. What Data Exists?
List the nouns (entities) in the system. Each noun = a potential DB table.
>

## 6. Who Sees What?
Are there different user roles? (anonymous, logged-in, admin)
>

## 7. Revenue Model
How does this make money? (SaaS, one-time, freemium, ads, open-source)
>

## 8. Success Metric
How do you know this is working? (users, revenue, usage count)
>

## 9. Existing Art
What already exists that does something similar? How is yours different?
>

## 10. Launch Target
When do you want v1 live? (1 week, 1 month, 3 months)
>

## 11. Scale Expectations
How many users in year 1? (10, 100, 10,000, 100,000)
>

## 12. Non-Negotiables
What MUST v1 have? What can wait for v2?
### v1 (must have)
>

### v2 (nice to have)
>
```

### How to Use It

1. Create a new repo (even if empty).
2. Add `SPEC.md` with the 12 questions answered.
3. Have Claude Code read the SPEC and generate the technical plan.
4. The SPEC becomes the source of truth for the project.

**Rule: If you cannot answer questions 1-4 clearly, you are not ready to build.**

---

## Phase 2: Tech Decision Tree

Use this decision tree to choose your stack. Start at the top, follow the
arrows.

```
START: "What am I building?"
  |
  +-- Static site / landing page / portfolio?
  |     --> HTML + CSS + JS (vanilla or Astro)
  |     --> Deploy: Netlify or Vercel
  |     --> Example: luna-qr
  |
  +-- Interactive tool (no user accounts, no saved data)?
  |     --> React + Vite + Tailwind
  |     --> Data in localStorage or URL params
  |     --> Deploy: Vercel (static)
  |     --> Example: luna-qr (enhanced)
  |
  +-- App with user accounts OR saved data?
        |
        +-- Do users need to log in?
        |     YES --> You need a backend + database
        |     NO  --> Can you use localStorage/IndexedDB?
        |              YES --> React + Vite (client-only)
        |              NO  --> You need a backend + database
        |
        +-- You need a backend + database:
              |
              +-- Simple CRUD (< 10 entities, < 1000 users)?
              |     --> React + Vite + Vercel Serverless + Vercel Postgres
              |     --> ORM: Drizzle
              |     --> Auth: Custom JWT (jose) or Clerk
              |     --> Deploy: Vercel
              |     --> Example: mid-complexity product apps
              |
              +-- Complex app (10+ entities, workflows, queues, roles)?
                    --> React + TypeScript + NestJS + PostgreSQL + Prisma
                    --> Auth: Custom JWT or Auth0
                    --> Deploy: DigitalOcean App Platform or Railway
                    --> Example: large-scale monorepo apps
```

### Quick Decision Table

| Question | Answer | Stack Choice |
|----------|--------|-------------|
| Need user login? | No | Client-only (React + Vite) |
| Need user login? | Yes, simple | Vercel Serverless + Postgres |
| Need user login? | Yes, complex roles/permissions | NestJS + PostgreSQL |
| Need real-time? | WebSockets | NestJS or Supabase |
| Need file uploads? | S3-compatible (DigitalOcean Spaces, AWS S3) | |
| Need email? | Resend | |
| Need payments? | Stripe | |
| Need background jobs? | Inngest, BullMQ, or Vercel Cron | |
| Need AI/ML? | OpenAI API, RunPod for custom models | |

### Database Decision

```
Do you need to save data between sessions?
  NO  --> localStorage / IndexedDB (client-only)
  YES --> Do you need data shared between users?
            NO  --> localStorage / IndexedDB
            YES --> You need a database
                    |
                    Simple (< 10 tables)?
                      --> Vercel Postgres + Drizzle
                    Complex (10+ tables, relations, migrations)?
                      --> Standalone PostgreSQL + Prisma
                    Key-value / document store?
                      --> Upstash Redis or Supabase
```

---

## Phase 3: Project Scaffold

### 3.1 GitHub Repo Setup

Run this for every new project:

```bash
# Create repo
gh repo create <your-org>/<project-name> --private --clone
cd <project-name>

# Initialize
git init
echo "node_modules/\n.DS_Store\n.env\n*.db\n*.db-journal\ndist/\n.cache/" > .gitignore

# Create structure
mkdir -p .claude/commands .github/workflows docs scripts tests

# Create SPEC
cp ~/code/<your-org>/Memex/docs/templates/SPEC-TEMPLATE.md SPEC.md

# Create CLAUDE.md (critical for AI workflow)
cp ~/code/<your-org>/Memex/docs/templates/CLAUDE-TEMPLATE.md .claude/CLAUDE.md

# Create CI
cp ~/code/<your-org>/Memex/docs/templates/ci-node.yml .github/workflows/ci.yml
# OR for Python:
# cp ~/code/<your-org>/Memex/docs/templates/ci-python.yml .github/workflows/ci.yml

# Create README
cp ~/code/<your-org>/Memex/docs/templates/README-TEMPLATE.md README.md

# MCP config for Memex integration
cp ~/code/<your-org>/Memex/docs/templates/mcp-template.json .mcp.json

# Initial commit
git add -A
git commit -m "chore: initial project scaffold

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>"
git push -u origin main
```

### 3.2 Standard Directory Structure

Every project follows this layout (adapt based on stack):

```
<project>/
  .claude/
    CLAUDE.md              # AI assistant context (REQUIRED)
    commands/              # Slash commands for Claude Code
      run-tests.md
      deploy.md
  .github/
    workflows/
      ci.yml               # CI pipeline
  .mcp.json                # Memex + AgentBridge MCP config
  docs/                    # Project documentation
  scripts/                 # Utility scripts
  tests/                   # Test files
  src/                     # Source code
  SPEC.md                  # The 12 questions (Phase 1)
  README.md                # Standard README
  .gitignore
  .env.example             # Environment variable template (never commit .env)
  package.json             # (Node.js projects)
  # OR
  pyproject.toml           # (Python projects)
```

### 3.3 GitHub Repo Settings

Apply these settings to every repo:

```bash
# Enable branch protection on main
gh api repos/<your-org>/<project-name>/branches/main/protection \
  --method PUT \
  --field required_status_checks='{"strict":true,"contexts":["test"]}' \
  --field enforce_admins=false \
  --field required_pull_request_reviews='{"required_approving_review_count":1}' \
  --field restrictions=null

# Enable issues
gh repo edit <your-org>/<project-name> --enable-issues

# Add standard labels
gh label create "enhancement" --color "a2eeef" --repo <your-org>/<project-name>
gh label create "bug" --color "d73a4a" --repo <your-org>/<project-name>
gh label create "security" --color "e4e669" --repo <your-org>/<project-name>
gh label create "documentation" --color "0075ca" --repo <your-org>/<project-name>
gh label create "testing" --color "bfd4f2" --repo <your-org>/<project-name>
gh label create "devops" --color "d4c5f9" --repo <your-org>/<project-name>
gh label create "ui" --color "f9d0c4" --repo <your-org>/<project-name>
gh label create "v1" --color "006b75" --repo <your-org>/<project-name>
gh label create "v2" --color "5319e7" --repo <your-org>/<project-name>
```

---

## Phase 4: Development Flow

### 4.1 Branch Strategy

Keep it simple. Two tiers based on project complexity:

**Tier 1 - Simple projects (Memex, luna-qr, AgentBridge, tools):**
```
main (production)
  |
  +-- feature/xyz
  +-- fix/xyz
```
- Merge directly to main via PR.
- Deploy on merge to main.

**Tier 2 - Products with users:**
```
main (production)
  |
  +-- staging (QA / preview)
        |
        +-- develop (daily work)
              |
              +-- feature/xyz
              +-- fix/xyz
```
- Feature branches merge to develop.
- Deploy to staging by merging develop to staging (via PR).
- Deploy to production by merging staging to main (via PR).

**Branch naming convention:**
```
feature/<short-description>    # New capability
feat/<short-description>       # Alias for feature
fix/<short-description>        # Bug fix
hotfix/<short-description>     # Urgent production fix
chore/<description>            # Maintenance, deps, config
docs/<description>             # Documentation only
security/<description>         # Security fix
refactor/<description>         # Code restructuring
```

### 4.2 PR Process

Every PR must include:

1. **Title** in conventional commit format: `feat(auth): add Google OAuth login`
2. **Description** with:
   - What changed and why
   - How to test it
   - Screenshots (for UI changes)
3. **Passing CI** (tests, lint, typecheck, build)
4. **Self-review** (read your own diff before requesting review)

PR template (`.github/PULL_REQUEST_TEMPLATE.md`):

```markdown
## What

<!-- What changed and why? -->

## How to Test

<!-- Steps to verify this works -->

## Checklist
- [ ] Tests pass (`npm test`)
- [ ] Linting passes
- [ ] Self-reviewed the diff
- [ ] No secrets committed
```

### 4.3 Testing Strategy

**Minimum viable testing for every project:**

| Layer | What to Test | Tool | When |
|-------|-------------|------|------|
| Unit | Pure functions, utilities, business logic | Node `--test` or Jest | Every PR |
| Integration | API endpoints, database queries | Jest + Supertest | Every PR |
| E2E | Critical user flows (login, core action, checkout) | Playwright | Before release |
| Security | `npm audit`, dependency check | npm audit | Every PR (CI) |

**What to test first (80/20 rule):**

1. Authentication flows (login, logout, token refresh)
2. Data creation (can I create the main entity?)
3. Data retrieval (can I list/search entities?)
4. Authorization (can unprivileged users access admin routes?)
5. Edge cases in business logic (calculations, state machines)

**What NOT to test (saves time, AI can regenerate):**

- UI component rendering (unless complex interactive state)
- CSS styling
- Third-party library behavior
- Simple CRUD with no business logic

**E2E test template (Playwright):**

```typescript
// tests/e2e/critical-path.spec.ts
import { test, expect } from '@playwright/test';

test('user can sign up, create item, and see it in list', async ({ page }) => {
  // 1. Sign up
  await page.goto('/signup');
  await page.fill('[name=email]', 'test@example.com');
  await page.fill('[name=password]', 'TestPass123!');
  await page.click('button[type=submit]');
  await expect(page).toHaveURL('/dashboard');

  // 2. Create main entity
  await page.click('[data-testid=create-button]');
  await page.fill('[name=name]', 'Test Item');
  await page.click('[data-testid=save-button]');

  // 3. Verify it appears
  await expect(page.locator('[data-testid=item-list]')).toContainText('Test Item');
});
```

### 4.4 Deployment

**Default deployment targets by stack:**

| Stack | Deploy To | How |
|-------|----------|-----|
| Static HTML/JS | Netlify | Push to main |
| React + Vite (client-only) | Vercel | Push to main |
| React + Vercel Serverless | Vercel | Push to main |
| NestJS + PostgreSQL | DigitalOcean App Platform | PR merge to staging/main |
| Python/FastAPI | Railway or Fly.io | Push to main |

**Deployment checklist (add to `.claude/commands/deploy.md`):**

```markdown
# Deploy

## Pre-deploy
1. All tests pass: `npm test`
2. Build succeeds: `npm run build`
3. No TypeScript errors: `npx tsc --noEmit`
4. Security audit clean: `npm audit --audit-level=high`
5. Environment variables set in deploy target

## Deploy
- Push to main (auto-deploy) or create deploy PR
```

---

## Phase 5: AI-Optimized Workflow

This is the most important section. Your competitive advantage is that you
build with AI. Everything below makes AI assistants dramatically more effective.

### 5.1 CLAUDE.md (Required for Every Project)

The `.claude/CLAUDE.md` file is the single most impactful thing you can do
for AI-assisted development. It is the first thing Claude Code reads when it
opens a project. A good CLAUDE.md eliminates 80% of "dumb AI mistakes."

**What to include:**

```markdown
# [Project Name] -- Repo-Specific Instructions

## About
- **What:** One sentence description
- **Tech:** React, TypeScript, Vite, Tailwind, Vercel Postgres, Drizzle
- **URL:** https://your-app.vercel.app

## Standards
- **Commit:** `<type>(<scope>): <description>` (feat|fix|docs|style|refactor|test|chore)
- **PR:** tests + self-review + lint + typecheck + build + 1 approval
- **Branches:** feature/, fix/, hotfix/, chore/, docs/

## Commands
```bash
npm run dev          # Start dev server
npm test             # Run tests
npm run build        # Production build
npx tsc --noEmit     # Type check
```

## Architecture Decisions
<!-- Add important decisions here so AI doesn't re-argue them -->
- Auth: Custom JWT with jose (not Clerk, not Auth0)
- ORM: Drizzle (not Prisma) -- Vercel Serverless size limit
- State: Zustand (not Redux, not Context)

## Known Gotchas
<!-- Save AI from making the same mistakes -->
- Vercel Hobby plan: max 12 serverless functions
- API routes must be in /api directory for Vercel bundling
- Use `jose` not `jsonwebtoken` (Edge Runtime compatible)

## File Map
<!-- Help AI navigate the codebase -->
- `src/pages/` -- Page components (one per route)
- `src/components/` -- Reusable UI components
- `src/lib/api.ts` -- API client (all fetch calls)
- `src/db/schema.ts` -- Database schema (Drizzle)
- `api/` -- Vercel serverless functions

## Deep Queries
```bash
node ~/code/<your-org>/Memex/scripts/memex-loader.js quick "<query>"
```
```

**Rules for CLAUDE.md:**

1. Keep it under 150 lines. Conciseness saves tokens.
2. Update it when you make architecture decisions.
3. Include "Known Gotchas" -- these prevent repeated mistakes.
4. Include a file map -- this prevents AI from guessing where things are.
5. Include the exact commands to run tests, build, and deploy.

### 5.2 Slash Commands (`.claude/commands/`)

Create reusable Claude Code commands for repetitive tasks.

**Essential commands for every project:**

`.claude/commands/run-tests.md`:
```markdown
# Run Tests

Run the test suite and report results.

## Steps
1. Run tests:
```bash
cd ~/code/<user>/<your-org>/<project> && npm test 2>&1
```

2. If TypeScript project, also run type check:
```bash
cd ~/code/<user>/<your-org>/<project> && npx tsc --noEmit 2>&1 | tail -30
```

3. Report: total tests, passed, failed (with details).
```

`.claude/commands/deploy.md`:
```markdown
# Deploy

## Pre-flight
1. `npm test` -- all tests pass
2. `npm run build` -- build succeeds
3. `npx tsc --noEmit` -- no type errors
4. `npm audit --audit-level=high` -- no critical vulnerabilities
5. `git status` -- no uncommitted changes

## Deploy
Create a PR from current branch to main:
```bash
gh pr create --base main --head $(git branch --show-current) \
  --title "<title>" --body "<description>"
```
```

`.claude/commands/new-feature.md`:
```markdown
# New Feature

Start a new feature branch with proper setup.

## Steps
1. `git checkout main && git pull`
2. `git checkout -b feature/$ARGUMENTS`
3. Report: "Ready to build on feature/$ARGUMENTS"
```

### 5.3 MCP Integration (Memex + AgentBridge)

Every project should have a `.mcp.json` that connects to Memex:

```json
{
  "mcpServers": {
    "memex": {
      "command": "node",
      "args": ["~/code/<user>/<your-org>/Memex/scripts/mcp-server.mjs"]
    }
  }
}
```

This gives the AI assistant access to:
- Cross-project knowledge ("how did we handle auth in project X?")
- Session history ("what did we work on last week?")
- Institutional memory that persists across sessions

**When AgentBridge is ready, add it too:**

```json
{
  "mcpServers": {
    "memex": {
      "command": "node",
      "args": ["~/code/<user>/<your-org>/Memex/scripts/mcp-server.mjs"]
    },
    "agentbridge": {
      "command": "python",
      "args": ["-m", "agentbridge.mcp_server"],
      "cwd": "~/code/<user>/<your-org>/AgentBridge"
    }
  }
}
```

### 5.4 Session Memory (Remember)

At the end of every significant coding session, save what you did:

```bash
~/code/<your-org>/Memex/scripts/remember "what you accomplished" --topics tag1,tag2
```

This feeds Memex and makes future AI sessions smarter. Do this especially for:
- Architecture decisions ("chose Drizzle over Prisma because of Vercel size limits")
- Bug fixes ("fixed auth token refresh loop -- was caused by stale cookie")
- Deployment changes ("moved from Netlify to Vercel for serverless functions")

### 5.5 AI-Friendly Code Practices

These practices make AI assistants produce better code:

1. **Explicit types** -- TypeScript with strict mode. AI generates far fewer bugs.
2. **Colocated tests** -- Tests next to source files or in a parallel `tests/` dir.
3. **Small files** -- Under 300 lines. AI works best with focused files.
4. **Descriptive names** -- `createInvoice()` not `processItem()`. AI reads names.
5. **Comments on "why", not "what"** -- AI can read the code; it needs the intent.
6. **Environment variables in .env.example** -- AI knows what config is needed.
7. **Error messages that explain the fix** -- `"Missing API key. Set RESEND_API_KEY in .env"` not `"Config error"`.

---

## Phase 6: Project Board

### Tool: GitHub Projects (built-in, free, zero new tools)

You already use GitHub. Use GitHub Projects (the built-in project board).

**Setup for each project:**

```bash
# Create a project board (do this once per project via github.com)
# Settings > Projects > New Project > Board
```

### Board Columns

Keep it to 4 columns:

| Column | Meaning |
|--------|---------|
| **Backlog** | Ideas and future work. Not committed to. |
| **Todo** | Committed for this sprint/week. Will be done. |
| **In Progress** | Someone (human or AI) is actively working on it. |
| **Done** | Shipped. PR merged. |

No "Review" column. No "QA" column. You are 2 people. Keep it simple.

### Labels

Use the same labels across all repos (created in Phase 3):

| Label | Color | Meaning |
|-------|-------|---------|
| `enhancement` | teal | New feature |
| `bug` | red | Something broken |
| `security` | yellow | Security fix |
| `documentation` | blue | Docs only |
| `testing` | light blue | Test coverage |
| `devops` | purple | CI/CD/infra |
| `ui` | peach | Visual/UX change |
| `v1` | dark teal | Must ship in v1 |
| `v2` | violet | Deferred to v2 |

### Workflow

1. **Weekly planning** (15 min): Move items from Backlog to Todo.
2. **During work**: Move Todo to In Progress when starting, Done when PR merged.
3. **End of week**: Review Done column. Save a Memex session summarizing the week.

**Claude Code integration:**

```bash
# List current tasks
gh issue list --repo <your-org>/<project> --state open

# Create a task
gh issue create --repo <your-org>/<project> \
  --title "feat(auth): add password reset" \
  --label "enhancement,v1" \
  --assignee Pamperito74

# Close a task
gh issue close <number> --repo <your-org>/<project>
```

---

## Phase 7: Quality Gates

### Before Every PR

These must pass before a PR can be merged. Enforced by CI.

| Gate | Command | Required For |
|------|---------|-------------|
| Tests pass | `npm test` | All projects |
| Build succeeds | `npm run build` | All projects |
| Type check | `npx tsc --noEmit` | TypeScript projects |
| Lint | `npx eslint .` | Projects with eslint |
| Security audit | `npm audit --audit-level=high` | All projects |
| No secrets | `.gitignore` includes `.env` | All projects |

### CI Pipeline Template (GitHub Actions)

**Node.js projects (`.github/workflows/ci.yml`):**

```yaml
name: CI

on:
  push:
    branches: [main]
  pull_request:
    branches: [main]

jobs:
  test:
    runs-on: ubuntu-latest
    strategy:
      matrix:
        node-version: [20, 22]

    steps:
      - uses: actions/checkout@v4

      - name: Use Node.js ${{ matrix.node-version }}
        uses: actions/setup-node@v4
        with:
          node-version: ${{ matrix.node-version }}
          cache: npm

      - name: Install dependencies
        run: npm ci

      - name: Type check
        run: npx tsc --noEmit || true

      - name: Lint
        run: npx eslint . || true

      - name: Run tests
        run: npm test

      - name: Build
        run: npm run build || true

      - name: Security audit
        run: npm audit --audit-level=high
```

**Python projects (`.github/workflows/ci.yml`):**

```yaml
name: CI

on:
  push:
    branches: [main]
  pull_request:
    branches: [main]

jobs:
  test:
    runs-on: ubuntu-latest
    strategy:
      matrix:
        python-version: ["3.11", "3.12"]

    steps:
      - uses: actions/checkout@v4

      - name: Set up Python ${{ matrix.python-version }}
        uses: actions/setup-python@v5
        with:
          python-version: ${{ matrix.python-version }}

      - name: Install dependencies
        run: |
          python -m pip install --upgrade pip
          pip install -e ".[dev]"

      - name: Lint
        run: ruff check . || true

      - name: Type check
        run: mypy . || true

      - name: Run tests
        run: pytest -v
```

### Before Every Release

Additional checks before going to production:

| Gate | How |
|------|-----|
| E2E tests pass | `npx playwright test` |
| Manual smoke test | Open staging URL, test core flow |
| Environment variables set | Check deploy target has all vars from `.env.example` |
| Database migrations applied | Check migration status |
| No `TODO` or `FIXME` in critical paths | Search codebase |

### Security Baseline

Every project must have:

1. `.env` in `.gitignore` (never commit secrets)
2. `.env.example` with placeholder values (document what env vars exist)
3. `npm audit` in CI (catch vulnerable dependencies)
4. Input validation on all API endpoints (zod or class-validator)
5. Auth tokens with expiration (never permanent tokens)
6. CORS configured (not `*` in production)

---

## Appendix A: Templates

All templates live in `~/code/<user>/<your-org>/Memex/docs/templates/`.
Copy them when scaffolding a new project.

### SPEC Template

File: `docs/templates/SPEC-TEMPLATE.md`

(See Phase 1 above -- the 12 questions.)

### CLAUDE.md Template

File: `docs/templates/CLAUDE-TEMPLATE.md`

```markdown
# [Project Name] -- Repo-Specific Instructions

## About
- **What:** [one sentence]
- **Tech:** [stack]
- **URL:** [deployed URL]

## Standards
- **Commit:** `<type>(<scope>): <description>` (feat|fix|docs|style|refactor|test|chore)
- **PR:** tests + self-review + lint + typecheck + build + 1 approval
- **Branches:** feature/, fix/, hotfix/, chore/, docs/

## Commands
\`\`\`bash
npm run dev          # Start dev server
npm test             # Run tests
npm run build        # Production build
\`\`\`

## Architecture Decisions
- [Decision]: [Reasoning]

## Known Gotchas
- [Gotcha]: [How to avoid]

## File Map
- `src/` -- Source code
- `tests/` -- Test files
- `api/` -- API routes (if applicable)
- `scripts/` -- Utility scripts

## Deep Queries
\`\`\`bash
node ~/code/<your-org>/Memex/scripts/memex-loader.js quick "<query>"
\`\`\`
```

### README Template

File: `docs/templates/README-TEMPLATE.md`

```markdown
# [Project Name]

[One sentence description]

## Quick Start

\`\`\`bash
# Install
npm install

# Development
npm run dev

# Test
npm test

# Build
npm run build
\`\`\`

## Tech Stack

- **Frontend:** [React, TypeScript, Tailwind]
- **Backend:** [NestJS / Vercel Serverless / none]
- **Database:** [PostgreSQL + Drizzle / none]
- **Deploy:** [Vercel / DigitalOcean / Netlify]

## Project Structure

\`\`\`
src/
  components/    # UI components
  pages/         # Page components
  lib/           # Utilities and helpers
  db/            # Database schema and queries
api/             # API routes
tests/           # Test files
\`\`\`

## Environment Variables

Copy `.env.example` to `.env` and fill in values:

\`\`\`bash
cp .env.example .env
\`\`\`

## Contributing

1. Create a feature branch: `git checkout -b feature/your-feature`
2. Make changes and add tests
3. Push and create a PR
4. All CI checks must pass

## License

MIT
```

### CI Templates

File: `docs/templates/ci-node.yml` -- see Phase 7 above.
File: `docs/templates/ci-python.yml` -- see Phase 7 above.

### MCP Template

File: `docs/templates/mcp-template.json`

```json
{
  "mcpServers": {
    "memex": {
      "command": "node",
      "args": ["~/code/<user>/<your-org>/Memex/scripts/mcp-server.mjs"]
    }
  }
}
```

---

## Appendix B: Stack Reference

### TinyDarkForge Standard Stack (2026)

| Layer | Default Choice | When to Use Something Else |
|-------|---------------|---------------------------|
| **Language** | TypeScript | Python for ML/data/scripts |
| **Frontend** | React + Vite + Tailwind | Astro for content sites |
| **UI Components** | Radix UI + shadcn/ui | Only if React |
| **State** | Zustand | React Query for server state |
| **Backend (simple)** | Vercel Serverless Functions | When < 12 API routes |
| **Backend (complex)** | NestJS | When > 12 routes, complex auth, queues |
| **Database** | PostgreSQL | Always. No MongoDB. No MySQL. |
| **ORM (Vercel)** | Drizzle | Smaller bundle for serverless |
| **ORM (standalone)** | Prisma | Better DX for complex schemas |
| **Auth** | Custom JWT (jose) | Clerk for fast prototyping |
| **Email** | Resend | |
| **Payments** | Stripe | |
| **File Storage** | S3 / DO Spaces | |
| **Deploy (simple)** | Vercel | Static sites, serverless |
| **Deploy (complex)** | DigitalOcean App Platform | Docker, background workers |
| **CI** | GitHub Actions | |
| **Monitoring** | Vercel Analytics or Sentry | |
| **AI Memory** | Memex | Always |
| **Agent Comms** | AgentBridge | Multi-agent workflows |

### Existing Projects Quick Reference

| Project | Stack | Deploy | Status |
|---------|-------|--------|--------|
| Memex | Node.js | npm package (local) | Active |
| AgentBridge | Python, FastAPI | Local service | Active |
| luna-qr | Static HTML/JS | Netlify | Active |

---

## Quick-Start Checklist (New Project)

Use this checklist every time you start a new project:

```
[ ] 1. Answer the 12 questions in SPEC.md
[ ] 2. Walk the Tech Decision Tree -- pick your stack
[ ] 3. Run the scaffold script (Phase 3)
[ ] 4. Fill in .claude/CLAUDE.md with project-specific context
[ ] 5. Set up .mcp.json for Memex integration
[ ] 6. Create GitHub Project board (4 columns)
[ ] 7. Create v1 issues from SPEC.md non-negotiables
[ ] 8. Start building (feature branch per issue)
[ ] 9. PR with CI gates before merge
[ ] 10. Save session to Memex when done
```

**Time from idea to first commit: 30 minutes.**
**Time from first commit to deployed v1: depends on scope, but the framework stays the same.**

---

## Future: The Web App Vision

This entire framework can become a web application:

1. User fills in the 12 questions (web form)
2. System walks the decision tree automatically
3. System generates: repo, scaffold, CLAUDE.md, CI, board, labels
4. User opens Claude Code and starts building with full context
5. Memex tracks progress across projects
6. AgentBridge coordinates multiple AI agents on the same project

The framework document you are reading IS the specification for that web app.

---

*TinyDarkForge Development Framework v1.0 -- 2026-02-20*
*Built for humans who build with AI.*
