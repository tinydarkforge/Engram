# Deploy

Prepare a deployment by running pre-flight checks and creating a PR.

## Pre-flight Checks

Run all of these. If any fail, stop and report.

1. **Tests pass:**
```bash
npm test 2>&1
```

2. **Build succeeds:**
```bash
npm run build 2>&1
```

3. **Type check (TypeScript only):**
```bash
npx tsc --noEmit 2>&1 | tail -20
```

4. **Security audit:**
```bash
npm audit --audit-level=high 2>&1
```

5. **No uncommitted changes:**
```bash
git status
```

## Deploy

If all checks pass, create a PR:

```bash
gh pr create --base main --head $(git branch --show-current) \
  --title "<title based on changes>" \
  --body "## Deploy

### Changes included:
$(git log --oneline main..HEAD)

### Pre-flight checks:
- [x] Tests pass
- [x] Build succeeds
- [x] Type check clean
- [x] Security audit clean
- [x] No uncommitted changes"
```

Tell the user the PR URL and that they need to merge it to trigger deploy.

## Rules
- NEVER push directly to main
- NEVER skip pre-flight checks
- Always create a PR -- user must approve
