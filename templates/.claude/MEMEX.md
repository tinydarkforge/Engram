# Memex - Auto-Load Context

**This file tells Claude to load Memex knowledge on startup.**

---

## Auto-Load Instructions

On startup, Claude should run:

```javascript
// Load Memex for this project
const memex = require('~/code/cirrus/DevOps/Memex/scripts/memex-loader.js');
const loader = new memex();
const context = loader.startup();

// Context now contains:
// - Global standards (commit, PR, branching, code, security)
// - Current project metadata (DemoProject)
// - Recent sessions
// - Quick refs for instant answers
```

**Location:** `~/code/cirrus/DevOps/Memex`

---

## Quick Access

### Instant Answers (from index, no file loading)

**Commit format:**
```
<type>(<scope>): <description>

Types: feat, fix, docs, style, refactor, test, chore
Example: feat(auth): add OAuth2 login
```

**PR requirements:**
- Tests added/updated
- Self-review completed
- Lint passes
- Type check passes
- Build succeeds
- At least 1 approval

**Branching:**
- `main` → Production
- `staging` → Pre-production/QA
- `develop` → Development
- `feature/*` → Feature branches

### Current Project: DemoProject

**Tech Stack:**
- Frontend: Next.js, React, TypeScript, Tailwind CSS
- Backend: NestJS, TypeScript, PostgreSQL, Prisma
- Workers: Python (ingestion)
- Testing: Jest, Cypress

**Architecture:** Monorepo
- `/apps/api/` - NestJS backend
- `/apps/web/` - Next.js frontend
- `/apps/cirrus-editor/` - Video editor
- `/workers/ingestion/` - Python worker

**Environments:**
- Dev: https://dev.example.com
- Staging: https://staging.example.com
- Prod: https://example.com

**Code Owners:** @Pamperito74, @Rhettyoungberg

---

## Commands Available

When user asks questions, you can:

1. **Check index first** (80% of queries)
   - Use quick_ref from Memex index
   - No file loading needed

2. **Search if needed** (15% of queries)
   - Search sessions for relevant context
   - Load summaries, not full content

3. **Load full content** (5% of queries)
   - Only when details are truly needed

### User Commands

Users can also explicitly call:

```bash
memex startup              # See full context
memex quick "commit"       # Quick answer
memex search auth          # Search across projects
save-session "summary" --topics tags  # Save work
```

---

## Cross-Project Access

If user asks about other projects:

```bash
"How did we handle OAuth in ProjectAuth?"
→ Load ~/code/cirrus/DevOps/Memex/projects/ProjectAuth/
```

---

**Auto-loaded on Claude startup for token efficiency.** 🧠⚡
