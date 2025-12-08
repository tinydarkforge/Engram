# Quick Context (Memex v1.0)

## Standards
- **Commit:** `<type>(<scope>): <description>` (feat|fix|docs|style|refactor|test|chore)
- **PR:** tests + self-review + lint + typecheck + build + 1 approval
- **Branches:** main(prod) → staging(QA) → develop(dev) → feature/*

## DemoProject
- **About:** ASL translation platform with automated quoting and workflow orchestration
- **Tech:** React, TypeScript, NestJS
- **Envs:** dev=https://dev.example.com | stg=https://staging.example.com | prd=https://example.com
- **Deploy staging:** `git fetch origin && git checkout staging && git reset --hard origin/develop && git push --force origin staging`
- **Deploy prod:** `git checkout main && git merge origin/staging && git push origin main`

## Recent Work
- 2025-12-05: Fixed all remaining TypeScript errors (76+ to 0) including UI component types, p
- 2025-12-03: HOTFIX: Fixed deployment failure by moving Prisma CLI to dependencies for produc
- 2025-12-02: Added Memex auto-update on startup - automatically stays in sync with <owner>

## Deep Queries
```bash
node ~/code/cirrus/DevOps/Memex/scripts/memex-loader.js quick "<query>"
```

---
*Token-optimized. Full Memex: ~/code/cirrus/DevOps/Memex*
