# Ledger Guide: Managing Facts with Confidence

This guide teaches you how to use the assertion ledger to track facts, build confidence through corroboration, detect contradictions, and manage assertions at scale.

## Quick Start: Create Your First Assertion

```bash
# Run this in a Node REPL or script
const ledger = require('./scripts/ledger');

const factId = ledger.createAssertion({
  plane: 'project:MyProject',
  class_: 'monotonic',
  claim: 'Node.js is installed',
  confidence: 0.8,
  staleness_model: 'flat',
  source_spans: ['terminal:verified_now'],
  density_hint: 'terse'
});

console.log(`Created assertion: ${factId}`);
```

✅ You now have a fact in the ledger.

## Understanding Planes

**Planes** separate claims by authority. They prevent mixing different sources of truth.

### Common Planes

| Plane | Purpose | Examples |
|-------|---------|----------|
| `user:name` | Personal decisions, opinions | `user:daniel`, `user:alice` |
| `project:name` | Project facts, architecture | `project:Memex`, `project:DemoProject` |
| `session:id` | Session-derived facts | `session:ci-2026-04-19-123456` |
| `api:source` | External API facts | `api:github`, `api:weather` |

### When to Use Each

- **user:daniel** — "I prefer TypeScript over Python" (personal preference)
- **project:Memex** — "Memex uses SQLite for persistence" (codebase fact)
- **session:abc123** — "During session abc123, we discovered X" (session output)
- **api:github** — "GitHub says repo has 10K stars" (external fact)

### Querying a Plane

```javascript
// All active facts in a plane
const projectFacts = ledger.queryActiveByPlane('project:Memex', { limit: 100 });
console.log(`Found ${projectFacts.length} facts`);

// Filter by class
const stateBoundFacts = ledger.queryActiveByPlane('project:Memex', {
  classes: ['state_bound'],
  limit: 50
});

// Get facts created after a date
const recent = ledger.queryActiveByPlane('project:Memex', {
  since: '2026-04-01T00:00:00Z'
});
```

## Assertion Lifecycle

Facts progress through these stages:

```
Created → Tentative → Established → Fossilized
            ↓ (contradicts detected)
            Quarantined
```

### Stage 1: Create (Tentative)
```javascript
const id = ledger.createAssertion({
  plane: 'project:Test',
  class_: 'monotonic',
  claim: 'The API is RESTful',
  confidence: 0.5,           // Start uncertain
  staleness_model: 'flat',
  source_spans: ['session:001'],
  density_hint: 'terse'
});
// Status: 'tentative'
// quorum_count: 1
```

Status is `tentative` because we have only one source. Confidence is 0.5 because we're not sure.

### Stage 2: Reinforce (Multiple Sources)
```javascript
// Another session confirms the API is RESTful
ledger.reinforceAssertion(id, {
  source_span: 'session:002',
  confidence_delta: 0.1       // Increase confidence
});
// Status: still 'tentative'
// quorum_count: 2
// confidence: 0.6

// A third source
ledger.reinforceAssertion(id, {
  source_span: 'session:003'
  // No confidence_delta → quorum only
});
// quorum_count: 3
// confidence: 0.6 (unchanged, no delta provided)
```

### Stage 3: Promote (Quorum Threshold)
```javascript
// When quorum_count >= 2, we can promote to established
const promoted = ledger.maybePromote(id, 2);  // threshold = 2
if (promoted) {
  console.log('✓ Now established!');
  // Status: 'established'
  // This fact is now trusted
}
```

### Stage 4: Mark Verified (state_bound only)
```javascript
// For assertions with staleness_model: 'state_bound'
// Re-verification resets the clock
ledger.markVerified(id);
// last_verified: NOW
```

### Stage 5: Fossilize (Obsolete)
```javascript
// When a fact is no longer relevant
ledger.markFossilized(id, 'obsolete: we switched to GraphQL');
// Status: 'fossilized'
// This fact is no longer active
```

## Building Confidence

Confidence and quorum work together:

```
confidence: [0.0 =========== 0.5 (uncertain) =========== 1.0 (certain)]
quorum:     [1 (guess)      2-3 (corroborated)           5+ (proven)]
```

### Example: Building Confidence for "Use React"

```javascript
// Session 1: Developer's hunch
const reactId = ledger.createAssertion({
  plane: 'project:NextApp',
  claim: 'We should use React',
  confidence: 0.5,           // Personal opinion
  source_spans: ['session:s1']
});

// Session 2: Team lead agrees
ledger.reinforceAssertion(reactId, {
  source_span: 'session:s2',
  confidence_delta: 0.15
});
// confidence: 0.65, quorum: 2

// Session 3: Architecture review confirms
ledger.reinforceAssertion(reactId, {
  source_span: 'session:s3',
  confidence_delta: 0.15
});
// confidence: 0.8, quorum: 3

// Session 4: Production metrics prove it works
ledger.reinforceAssertion(reactId, {
  source_span: 'metrics:prod_perf',
  confidence_delta: 0.15
});
// confidence: 0.95, quorum: 4

// Now promote to established
ledger.maybePromote(reactId, 2);
// Status: 'established'
```

Result: From "personal hunch" (0.5) → "team consensus" (0.65) → "proven in production" (0.95).

## Handling Contradictions

### Auto-Detection via Negation

When you ingest a fact that negates an existing one, they're automatically linked:

```javascript
const blueId = ledger.createAssertion({
  plane: 'project:sky',
  claim: 'The sky is blue',
  confidence: 0.9,
  source_spans: ['observation:001']
});

// Contradiction detected automatically
const notBlueId = ledger.ingest({
  plane: 'project:sky',
  claim: 'The sky is not blue',
  confidence: 0.3,
  source_spans: ['opinion:contrarian']
});
// ingest() detects negation and calls:
//   ledger.linkSupersession(notBlueId, blueId, 'contradicts')
// Result: tension_pair created
```

### Finding Contradictions

```javascript
// Get all unresolved tensions
const tensions = ledger.queryTensions({ resolved: false });
for (const tension of tensions) {
  const aData = ledger.getAssertion(tension.a_id);
  const bData = ledger.getAssertion(tension.b_id);
  console.log(`Tension: "${aData.claim}" ↔ "${bData.claim}"`);
}
```

### Manually Linking Relationships

```javascript
// Assertion A depends on Assertion B
ledger.linkSupersession(aId, bId, 'dominates');
// A will be excluded from queryActiveByPlane() if B is active

// A contradicts C
ledger.linkSupersession(aId, cId, 'contradicts');
// Creates tension_pair(a_id, c_id)

// B is an older version of D
ledger.linkSupersession(bId, dId, 'superseded_by');
```

## Staleness Models

Different facts need different decay strategies:

### flat
Never stale. For immutable facts.
```javascript
{
  staleness_model: 'flat',
  claim: 'Node.js is open-source'  // Always true
}
```

### exponential
Decays 2% per day after last reinforcement. For time-sensitive technical facts.
```javascript
{
  staleness_model: 'exponential',
  claim: 'React 18 is the latest version'  // Becomes stale as new versions release
}
```

### episodic
Flat if the plane is active, exponential if idle >30 days. For project facts.
```javascript
{
  staleness_model: 'episodic',
  plane: 'project:Memex',
  claim: 'Memex uses SQLite'  // True while project is active
}
```

### state_bound
Halves confidence if unverified >14 days. Requires explicit re-verification. For facts that need periodic review.
```javascript
{
  staleness_model: 'state_bound',
  claim: 'The API key is still valid',  // Must be verified every 14 days
  last_verified: '2026-04-15...'
}

// After >14 days without verification:
// confidence is halved in ranking
// Call markVerified() to reset the clock
ledger.markVerified(assertionId);
```

### contextual
Depends on external state. Confidence goes to 0 if session is inactive.
```javascript
{
  staleness_model: 'contextual',
  claim: 'Build is passing',  // Only true if build pipeline is active
  context: { session_active: true }
}
```

## Density Hints

Control how much detail a fact takes up in the context window:

```javascript
// terse: Just the claim (minimal tokens)
ledger.createAssertion({
  density_hint: 'terse',
  claim: 'Node v20 required'
});
// Output: "Node v20 required"

// standard: Claim + confidence + quorum (recommended)
ledger.createAssertion({
  density_hint: 'standard',
  claim: 'We use TypeScript',
  confidence: 0.9
});
// Output: "We use TypeScript (90%, quorum: 5)"

// verbose: All details — claim, body, status, sources
ledger.createAssertion({
  density_hint: 'verbose',
  claim: 'Docker is installed',
  body: 'Verified by running `docker --version` in terminal',
  confidence: 0.95
});
// Output: "Docker is installed (95%, established, 4 sources)\nVerified by running..."
```

## Practical Examples

### Example 1: Document a Codebase Decision
```javascript
// Capture: Why did we choose this tech?
ledger.createAssertion({
  plane: 'project:WebUI',
  class_: 'monotonic',
  claim: 'Frontend uses Next.js with App Router',
  body: 'Chosen for: SSR, file-based routing, built-in API routes, strong TypeScript support',
  confidence: 0.95,
  staleness_model: 'flat',  // Architecture decision doesn't decay
  source_spans: ['adr:next-framework', 'commit:arch-review'],
  density_hint: 'standard'
});
```

### Example 2: Track API Compatibility
```javascript
// API fact that needs periodic verification
const apiId = ledger.createAssertion({
  plane: 'api:stripe',
  class_: 'state_bound',
  claim: 'Stripe API v3.2 is compatible',
  confidence: 0.9,
  staleness_model: 'state_bound',
  source_spans: ['test:integration'],
  density_hint: 'terse'
});

// Every 30 days, re-verify the API
setInterval(() => {
  // Run integration tests
  const testsPass = runIntegrationTests();
  if (testsPass) {
    ledger.markVerified(apiId);
    console.log('✓ API still compatible');
  }
}, 30 * 24 * 60 * 60 * 1000);
```

### Example 3: Search for Related Facts
```javascript
// Find all claims about performance
const perfFacts = ledger.queryByClaim('performance', {
  plane: 'project:Memex',
  limit: 20
});

for (const fact of perfFacts) {
  console.log(`- ${fact.claim} (confidence: ${fact.confidence})`);
}
```

### Example 4: Bulk Transform with Confirmation (Phase 9)
```javascript
const { transformPlane } = require('./scripts/transform');

// Promote all tentative facts with 2+ sources
await transformPlane('project:Memex', {
  dryRun: false,
  action: 'promote',
  confidenceThreshold: 0.7
});

// User sees confirmation prompt:
// "Promote: 8 tentative → established (confidence >= 0.7)"
// "Continue? (yes/no): "
```

## Testing & Validation

### Unit Test Pattern
```javascript
const { _createForTesting } = require('./scripts/ledger');
const Database = require('better-sqlite3');
const { runSqlMigrations } = require('./scripts/migrations');

function makeTestLedger() {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  runSqlMigrations(db);
  return _createForTesting(db);
}

const ledger = makeTestLedger();
const id = ledger.createAssertion({...});
assert.ok(id);
```

See [tests/ledger.test.js](../tests/ledger.test.js) for 50+ reference examples.

## Common Patterns

### Pattern: Session Summary → Ledger Facts
```javascript
// When saving a session, extract key facts
const session = {
  summary: 'Implemented JWT auth',
  topics: ['auth', 'jwt'],
  findings: [
    { fact: 'JWT reduces DB queries by 40%', confidence: 0.8 },
    { fact: 'OpenID Connect adds 2s latency', confidence: 0.7 }
  ]
};

for (const finding of session.findings) {
  ledger.createAssertion({
    plane: `project:${session.project}`,
    claim: finding.fact,
    confidence: finding.confidence,
    source_spans: [`session:${session.id}`],
    density_hint: 'standard'
  });
}
```

### Pattern: MCP Integration
```javascript
// Inside an MCP tool
async function analyzeArchitecture() {
  // Get all established project facts
  const facts = ledger.queryActiveByPlane('project:MyApp', {
    classes: ['monotonic', 'episodic'],
    limit: 100
  });

  // Rank by confidence
  const ranked = ledger.rankActive('project:MyApp');

  // Select top N for LLM context
  const context = ledger.selectForContext('project:MyApp', 2000);  // 2K token budget

  return {
    facts: context,
    total_available: ranked.length,
    contradictions: ledger.queryTensions({ resolved: false }).length
  };
}
```

## Troubleshooting

| Problem | Solution |
|---------|----------|
| Fact not showing up in queryActiveByPlane() | Check: status not fossilized/quarantined, plane matches, class_ in filters |
| Quorum not increasing | Check: reinforceAssertion() called with source_span, assertion still tentative |
| Contradiction not detected | Check: negation heuristic (look for "not", "n't", "no", etc.), run scanPlane() explicitly |
| Old facts not decaying | Check: staleness_model, use rankActive() not queryActiveByPlane() (only rankActive applies decay) |
| MCP tools unavailable | Check: mcp-server.mjs running, ledger-*.mcp.json tools exported, test with ledgerStats() |

## Next Steps

- **Read**: [Assertion API Reference](./ASSERTION-API-REFERENCE.md) for complete function signatures
- **Explore**: [tests/ledger.test.js](../tests/ledger.test.js) for runnable examples
- **Try**: Phase 9 transform script for bulk operations with confirmation gate
- **Integrate**: Use ledger facts in your MCP tools and agents via ledgerIngest(), ledgerQuery(), ledgerSelectContext()
