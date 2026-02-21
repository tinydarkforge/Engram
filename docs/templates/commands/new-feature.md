# New Feature

Start a new feature branch with proper setup.

## Usage
`/new-feature <name>` -- create feature/<name> branch

## Steps

1. Ensure we are on main and up to date:
```bash
git checkout main && git pull origin main
```

2. Create the feature branch:
```bash
git checkout -b feature/$ARGUMENTS
```

3. Report: "Ready to build on feature/$ARGUMENTS"

## Rules
- Branch name should be lowercase, hyphen-separated
- If no name provided, ask the user for one
