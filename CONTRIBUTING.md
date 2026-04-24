# Contributing to Codicil

## Getting started

```bash
git clone https://github.com/TinyDarkForge/Codicil.git
cd Codicil
npm install
npm test
```

## Commit convention

```
<type>(<scope>): <description>
```

Types: `feat` `fix` `docs` `chore` `refactor` `test`

Examples:
- `feat(ledger): add confidence decay for episodic facts`
- `fix(mcp): handle missing graph.msgpack gracefully`
- `docs(readme): add platform support table`

## Pull request expectations

- `npm test` passes
- `npm run lint` passes (warnings OK, errors not)
- Self-reviewed before requesting review
- Issue linked in the PR description

## Code of conduct

See [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md).
