# Codicil - Auto-Load Context

**This file tells Claude to load Codicil knowledge on startup.**

---

## Auto-Load Instructions

On startup, Claude should run:

```javascript
// Load Codicil for this project
const codicil = require('~/code/<your-org>/Codicil/scripts/codicil-loader.js');
const loader = new codicil();
const context = loader.startup();

// Context now contains:
// - Global standards (commit, PR, branching, code, security)
// - Current project metadata
// - Recent sessions
// - Quick refs for instant answers
```

**Location:** `~/code/<your-org>/Codicil`

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

### Current Project

Fill in your project's tech stack, architecture, environments, and code owners here.

---

## Commands Available

When user asks questions, you can:

1. **Check index first** (80% of queries)
   - Use quick_ref from Codicil index
   - No file loading needed

2. **Search if needed** (15% of queries)
   - Search sessions for relevant context
   - Load summaries, not full content

3. **Load full content** (5% of queries)
   - Only when details are truly needed

### User Commands

Users can also explicitly call:

```bash
codicil startup              # See full context
codicil quick "commit"       # Quick answer
codicil search auth          # Search across projects
save-session "summary" --topics tags  # Save work
```

---

## Cross-Project Access

If user asks about other projects:

```bash
"How did we handle OAuth in <other-project>?"
→ Load ~/code/<your-org>/Codicil/projects/<other-project>/
```

---

**Auto-loaded on Claude startup for token efficiency.** 🧠⚡
