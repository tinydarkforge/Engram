# [Project Name] -- Repo-Specific Instructions

## About
- **What:** [one sentence description]
- **Tech:** [e.g., React, TypeScript, Vite, Tailwind, Vercel Postgres, Drizzle]
- **URL:** [deployed URL or "local only"]

## Standards
- **Commit:** `<type>(<scope>): <description>` (feat|fix|docs|style|refactor|test|chore)
- **PR:** tests + self-review + lint + typecheck + build + 1 approval
- **Branches:** feature/, fix/, hotfix/, chore/, docs/

## Commands
```bash
npm run dev          # Start dev server
npm test             # Run tests
npm run build        # Production build
npx tsc --noEmit     # Type check (TypeScript projects)
```

## Architecture Decisions
<!-- Add important decisions here so AI does not re-argue them -->
- [Decision]: [Reasoning]

## Known Gotchas
<!-- Save AI from making the same mistakes -->
- [Gotcha]: [How to avoid]

## File Map
<!-- Help AI navigate the codebase -->
- `src/` -- Source code
- `tests/` -- Test files
- `api/` -- API routes (if applicable)
- `scripts/` -- Utility scripts

## Deep Queries
```bash
node ~/code/TheDarkFactory/Memex/scripts/memex-loader.js quick "<query>"
```

## Save Session
```bash
~/code/TheDarkFactory/Memex/scripts/remember "what you did" --topics tag1,tag2
```

---
*Generated [DATE]*
