# Run Tests

Run the test suite and report results.

## Usage
`/run-tests` -- run all tests
`/run-tests <path>` -- run specific test file or directory

## Steps

### 1. Run tests
```bash
npm test 2>&1
```

### 2. If TypeScript project, run type check
```bash
npx tsc --noEmit 2>&1 | tail -30
```

### 3. Report results
- Total tests run
- Tests passed
- Tests failed (with details and suggested fix)

## Rules
- Always report failing tests prominently
- Do not modify tests unless asked
