# Quick Context (v1.0)

## Standards
- **Commit:** `<type>(<scope>): <description>` (feat|fix|docs|style|refactor|test|chore)
- **PR:** tests + self-review + lint + typecheck + build + 1 approval
- **Branches:** main(prod) → staging(QA) → develop(dev) → feature/*

## Project: {{PROJECT_NAME}}
- **Tech:** {{TECH_STACK}}
- **Deploy staging:** `{{DEPLOY_STG}}`
- **Deploy prod:** `{{DEPLOY_PRD}}`

## Deep Queries
For project history, past decisions, or cross-project knowledge:
```bash
node ~/code/cirrus/DevOps/Memex/scripts/memex-loader.js quick "<query>"
```

---
*Token-optimized context. Full Memex: ~/code/cirrus/DevOps/Memex*
