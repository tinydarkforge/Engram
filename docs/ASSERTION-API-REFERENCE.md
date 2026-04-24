# Assertion API Reference

Complete API documentation for the ledger system. All functions are available via the ledger module or MCP tools.

## Core Ledger API

All functions are exported from `scripts/ledger.js` and available as MCP tools via `mcp-tools.js`.

### createAssertion(params)

Create a new assertion (fact) in the ledger.

**Parameters:**
```javascript
{
  plane: string,                    // Required. Authority plane (e.g., 'project:Codicil')
  class_: string,                   // Required. Type: 'monotonic'|'episodic'|'state_bound'|'contextual'
  claim: string,                    // Required. The claim/fact (max 500 chars)
  body?: string,                    // Optional. Detailed explanation
  confidence?: number,              // Optional. [0.0-1.0], default 0.5
  staleness_model?: string,         // Optional. 'flat'|'exponential'|'episodic'|'state_bound'|'contextual', default 'flat'
  source_spans?: string[],          // Required. Non-empty array of sources (e.g., ['session:001', 'docs:readme'])
  density_hint?: string,            // Optional. 'terse'|'standard'|'verbose', default 'terse'
  cache_stable?: number             // Optional. 0|1, whether to prioritize in context selection, default 0
}
```

**Returns:** `string` — assertion ID (e.g., `a_1234567890_abc123`)

**Example:**
```javascript
const ledger = require('./scripts/ledger');

const id = ledger.createAssertion({
  plane: 'project:Codicil',
  class_: 'monotonic',
  claim: 'SQLite supports PRAGMA foreign_keys',
  confidence: 0.95,
  staleness_model: 'flat',
  source_spans: ['session:ci-2026-04-19', 'sqlite-docs'],
  density_hint: 'standard',
  cache_stable: 1
});
console.log(`Created: ${id}`);
```

**Throws:**
- `Error: createAssertion: plane is required`
- `Error: createAssertion: class_ is required`
- `Error: createAssertion: claim is required`
- `Error: createAssertion: source_spans must be a non-empty array`

---

### reinforceAssertion(id, options?)

Add evidence to an existing assertion. Increments quorum_count, optionally increases confidence.

**Parameters:**
```javascript
{
  id: string,                       // Required. Assertion ID
  source_span?: string,             // Optional. New source to add
  confidence_delta?: number         // Optional. Confidence increase [0.0-1.0]
}
```

**Returns:** `void`

**Example:**
```javascript
// Original assertion created with confidence 0.5
const id = ledger.createAssertion({...});

// New evidence increases confidence
ledger.reinforceAssertion(id, {
  source_span: 'session:002',
  confidence_delta: 0.15
});
// Now: confidence = min(1.0, 0.5 + 0.15) = 0.65, quorum_count = 2

// Another source, no confidence change
ledger.reinforceAssertion(id, {
  source_span: 'session:003'
});
// Now: confidence = 0.65, quorum_count = 3
```

**Throws:**
- `Error: reinforceAssertion: assertion not found: {id}`

---

### maybePromote(id, quorumThreshold?)

Promote tentative → established if quorum_count >= threshold.

**Parameters:**
```javascript
{
  id: string,                       // Required. Assertion ID
  quorumThreshold?: number          // Optional. Default 2
}
```

**Returns:** `boolean` — true if promotion happened, false otherwise

**Example:**
```javascript
const promoted = ledger.maybePromote(id, 2);
if (promoted) {
  console.log('✓ Now established!');
  // Status changed from 'tentative' to 'established'
}
```

---

### linkSupersession(childId, parentId, kind)

Link one assertion to another (relationship: dominates, contradicts).

**Parameters:**
```javascript
{
  childId: string,                  // Required. Assertion that depends on/contradicts parent
  parentId: string,                 // Required. Assertion being referenced
  kind: 'dominates' | 'contradicts' // Required. Relationship type
}
```

**Returns:** `void`

**Example:**
```javascript
// A dominates B → B is excluded from queryActiveByPlane() if A is active
ledger.linkSupersession(newVersionId, oldVersionId, 'dominates');

// A contradicts C → creates tension_pair(a_id, c_id)
ledger.linkSupersession(notBlueId, blueId, 'contradicts');
```

**Throws:**
- `Error: linkSupersession: child assertion not found: {childId}`
- `Error: linkSupersession: parent assertion not found: {parentId}`

---

### markFossilized(id, reason)

Mark an assertion as obsolete/no longer relevant.

**Parameters:**
```javascript
{
  id: string,                       // Required. Assertion ID
  reason: string                    // Required. Why (logged to stderr)
}
```

**Returns:** `void`

**Example:**
```javascript
ledger.markFossilized(oldFactId, 'superseded: switched to GraphQL');
// Status: 'tentative'|'established' → 'fossilized'
// Will no longer appear in queryActiveByPlane()
```

**Throws:**
- `Error: markFossilized: assertion not found: {id}`

---

### quarantine(id, reason)

Mark an assertion as problematic and remove from active results.

**Parameters:**
```javascript
{
  id: string,                       // Required. Assertion ID
  reason: string                    // Required. Why (logged to stderr)
}
```

**Returns:** `void`

**Example:**
```javascript
ledger.quarantine(badId, 'contradicts multiple established facts');
// Status: 'tentative'|'established' → 'quarantined'
```

---

### markVerified(id)

Update `last_verified` timestamp. Used for state_bound assertions.

**Parameters:**
```javascript
{
  id: string                        // Required. Assertion ID
}
```

**Returns:** `void`

**Example:**
```javascript
ledger.markVerified(apiKeyId);
// last_verified: NOW
// For state_bound staleness_model, resets the "days since verified" clock
```

**Throws:**
- `Error: markVerified: assertion not found: {id}`

---

### getAssertion(id)

Retrieve a single assertion with full details.

**Parameters:**
```javascript
{
  id: string                        // Required. Assertion ID
}
```

**Returns:**
```javascript
{
  id: string,
  plane: string,
  class: string,
  claim: string,
  body: string | null,
  confidence: number,
  quorum_count: number,
  status: 'tentative'|'established'|'fossilized'|'quarantined',
  created_at: string,               // ISO8601 timestamp
  last_reinforced: string | null,
  last_verified: string | null,
  staleness_model: string,
  cache_stable: number,
  density_hint: string,
  source_spans: string[],           // All sources that contributed
  supersedes: Array<{id, kind}>,    // Relationships where this is child
  superseded_by: Array<{id, kind}>  // Relationships where this is parent
}
```

**Example:**
```javascript
const fact = ledger.getAssertion(id);
console.log(`Claim: ${fact.claim}`);
console.log(`Confidence: ${(fact.confidence * 100).toFixed(1)}%`);
console.log(`Status: ${fact.status}`);
console.log(`Sources: ${fact.source_spans.join(', ')}`);
```

**Returns:** `null` if assertion not found

---

### queryActiveByPlane(plane, options?)

Get all active (non-fossilized, non-quarantined) assertions from a plane.

**Parameters:**
```javascript
{
  plane: string,                    // Required. Plane to query (e.g., 'project:Codicil')
  classes?: string[],               // Optional. Filter by class
  limit?: number,                   // Optional. Max results, default 100
  since?: string                    // Optional. ISO8601 timestamp filter
}
```

**Returns:** `Array<Assertion>`

**Example:**
```javascript
// All facts in project
const all = ledger.queryActiveByPlane('project:Codicil');

// Only state_bound facts (need periodic verification)
const statebound = ledger.queryActiveByPlane('project:Codicil', {
  classes: ['state_bound'],
  limit: 50
});

// Facts created after a date
const recent = ledger.queryActiveByPlane('project:Codicil', {
  since: '2026-04-01T00:00:00Z'
});
```

---

### queryByClaim(substring, options?)

Search for assertions by claim text.

**Parameters:**
```javascript
{
  substring: string,                // Required. Substring to match (case-insensitive)
  plane?: string,                   // Optional. Restrict to plane
  limit?: number                    // Optional. Default 50
}
```

**Returns:** `Array<Assertion>`

**Example:**
```javascript
const results = ledger.queryByClaim('React', { plane: 'project:Web', limit: 20 });
for (const r of results) {
  console.log(`- ${r.claim} (${(r.confidence * 100).toFixed(0)}%)`);
}
```

---

### queryTensions(options?)

Get contradiction pairs.

**Parameters:**
```javascript
{
  resolved?: boolean                // Optional. true=resolved, false=unresolved, undefined=all
}
```

**Returns:**
```javascript
Array<{
  a_id: string,
  b_id: string,
  detected_at: string,
  resolved_at: string | null,
  resolution: string | null
}>
```

**Example:**
```javascript
const tensions = ledger.queryTensions({ resolved: false });
console.log(`Found ${tensions.length} unresolved contradictions`);

for (const t of tensions) {
  const a = ledger.getAssertion(t.a_id);
  const b = ledger.getAssertion(t.b_id);
  console.log(`Tension: "${a.claim}" ↔ "${b.claim}"`);
}
```

---

### setCounterfactualWeight(id, value)

Set importance weight for an assertion. Used in ranking to boost/suppress scores.

**Parameters:**
```javascript
{
  id: string,                       // Required. Assertion ID
  value: number                     // Required. Weight multiplier (0.0-∞, 1.0 = no effect)
}
```

**Returns:** `void`

**Example:**
```javascript
// Suppress low-confidence assertion
ledger.setCounterfactualWeight(uncertainId, 0.1);
// Score becomes min(1.0, 0.3 * 0.1) = 0.03 in ranking

// Boost high-priority fact
ledger.setCounterfactualWeight(priorityId, 2.0);
// Score becomes min(1.0, 0.6 * 2.0) = 1.0 in ranking
```

---

### rankActive(plane, options?)

Get all active assertions ranked by importance score.

**Parameters:**
```javascript
{
  plane: string,                    // Required. Plane to rank
  classes?: string[],               // Optional. Filter by class
  limit?: number,                   // Optional. Max results, default 100
  since?: string,                   // Optional. ISO8601 filter
  now?: Date,                       // Optional. Time reference for decay, default now
  context?: object                  // Optional. Context for decay models
}
```

**Returns:**
```javascript
Array<Assertion & {
  score: number,                    // [0.0-1.0] importance score
  in_tension: boolean               // true if in unresolved contradiction
}>
```

**Example:**
```javascript
const ranked = ledger.rankActive('project:Codicil');
console.log('Top 5 facts by importance:');
ranked.slice(0, 5).forEach(r => {
  console.log(`[${(r.score * 100).toFixed(0)}%] ${r.claim}`);
});
```

---

### selectForContext(plane, budget, options?)

Select top assertions that fit within a token budget. Greedy packing with cache_stable priority.

**Parameters:**
```javascript
{
  plane: string,                    // Required. Plane to select from
  budget: number,                   // Required. Token budget (character count)
  classes?: string[],               // Optional. Filter by class
  limit?: number,                   // Optional. Max results
  since?: string,                   // Optional. ISO8601 filter
  now?: Date,                       // Optional. Time reference
  context?: object                  // Optional. Context for decay
}
```

**Returns:** `Array<Assertion>`

**Example:**
```javascript
// Get high-value facts that fit in 2000 tokens
const context = ledger.selectForContext('project:Codicil', 2000);
console.log(`Selected ${context.length} facts for prompt`);
console.log('Facts:', context.map(c => c.claim));
```

---

### stats()

Get aggregate statistics.

**Parameters:** (none)

**Returns:**
```javascript
{
  total: number,
  by_status: {
    tentative: number,
    established: number,
    fossilized: number,
    quarantined: number
  },
  by_plane: {
    [plane: string]: number,
    ...
  },
  tensions_open: number
}
```

**Example:**
```javascript
const s = ledger.stats();
console.log(`Total assertions: ${s.total}`);
console.log(`Status breakdown: ${JSON.stringify(s.by_status)}`);
console.log(`Unresolved contradictions: ${s.tensions_open}`);
```

---

### ingest(params, options?)

Smart ingestion: create assertion or reinforce if duplicate found.

**Parameters:**
```javascript
{
  plane: string,                    // Required
  class_: string,                   // Required
  claim: string,                    // Required
  confidence?: number,              // Optional
  staleness_model?: string,         // Optional
  source_spans: string[],           // Required
  density_hint?: string,            // Optional
  cache_stable?: number,            // Optional
  dupThreshold?: number,            // Optional. Jaccard similarity threshold, default 0.7
  negThreshold?: number             // Optional. Negation threshold, default 0.7
}
```

**Returns:**
```javascript
{
  action: 'created' | 'reinforced',
  id: string,
  similarity?: number,              // if 'reinforced'
  negations?: string[]              // if 'created', IDs of contradicting facts auto-linked
}
```

**Example:**
```javascript
// Near-duplicate → reinforces existing
const result1 = ledger.ingest({
  plane: 'project:Test',
  claim: 'The API is RESTful',
  confidence: 0.8,
  source_spans: ['session:002']
});
// action: 'reinforced', similarity: 0.95

// Negation → creates new fact and links contradiction
const result2 = ledger.ingest({
  plane: 'project:Test',
  claim: 'The API is not RESTful',
  confidence: 0.3,
  source_spans: ['opinion:contrarian']
});
// action: 'created', negations: ['a_xxx'] (from previous fact)
```

---

## MCP Tool Wrappers

All ledger functions are exposed as MCP tools for use in agents and Claude Code.

### ledgerIngest

Wrap of `ingest()`. Parameters use snake_case.

```javascript
await ledgerIngest({
  plane: 'project:Codicil',
  class_: 'monotonic',
  claim: 'Fact here',
  confidence: 0.8,
  source_spans: ['session:001']
});
```

### ledgerQuery

Wrap of `queryActiveByPlane()`.

```javascript
const result = await ledgerQuery('project:Codicil', { limit: 50 });
// Returns: { ok: true, plane, total, assertions }
```

### ledgerSelectContext

Wrap of `selectForContext()` with rendering.

```javascript
const result = await ledgerSelectContext('project:Codicil', 2000);
// Returns: { ok: true, plane, budget, selected, used, rendered }
// rendered: markdown string ready for prompt injection
```

### ledgerStats

Wrap of `stats()`.

```javascript
const result = await ledgerStats();
// Returns: { ok: true, stats }
```

### ledgerScanSentinel

Wrap of `contradiction-sentinel.scanPlane()`.

```javascript
const result = await ledgerScanSentinel('project:Codicil', { sampleSize: 50 });
// Returns: { ok: true, plane, tensions_found }
```

### ledgerRunVerifications

Wrap of `verification-hooks.runPending()`.

```javascript
const result = await ledgerRunVerifications('project:Codicil', { staleDays: 14 });
// Returns: { ok: true, plane, results }
```

### ledgerWeight

Wrap of `setCounterfactualWeight()`.

```javascript
const result = await ledgerWeight('a_xxx', 0.5);
// Returns: { ok: true, id, value }
```

### ledgerTransform

Wrap of `transform.transformPlane()` (Phase 9).

```javascript
const result = await ledgerTransform('project:Codicil', {
  dry_run: false,
  action: 'promote',
  confidence_threshold: 0.7
});
// Returns: { ok: true, plane, changes, executed, errors }
```

---

## Database Schema

### assertions table

```sql
CREATE TABLE assertions (
  id TEXT PRIMARY KEY,
  plane TEXT NOT NULL,
  class TEXT NOT NULL,
  claim TEXT NOT NULL,
  body TEXT,
  confidence REAL NOT NULL DEFAULT 0.5,
  quorum_count INTEGER NOT NULL DEFAULT 1,
  status TEXT NOT NULL DEFAULT 'tentative',
  created_at TEXT NOT NULL,
  last_reinforced TEXT,
  last_verified TEXT,
  staleness_model TEXT NOT NULL DEFAULT 'flat',
  cache_stable INTEGER NOT NULL DEFAULT 0,
  density_hint TEXT NOT NULL DEFAULT 'terse'
);
```

### assertion_lineage table

```sql
CREATE TABLE assertion_lineage (
  assertion_id TEXT NOT NULL,
  source_span TEXT NOT NULL,
  UNIQUE (assertion_id, source_span),
  FOREIGN KEY (assertion_id) REFERENCES assertions (id)
);
```

### supersession_edges table

```sql
CREATE TABLE supersession_edges (
  child_id TEXT NOT NULL,
  parent_id TEXT NOT NULL,
  kind TEXT NOT NULL,  -- 'dominates' | 'contradicts'
  created_at TEXT NOT NULL,
  UNIQUE (child_id, parent_id, kind),
  FOREIGN KEY (child_id) REFERENCES assertions (id),
  FOREIGN KEY (parent_id) REFERENCES assertions (id)
);
```

### tension_pairs table

```sql
CREATE TABLE tension_pairs (
  a_id TEXT NOT NULL,
  b_id TEXT NOT NULL,
  detected_at TEXT NOT NULL,
  resolved_at TEXT,
  resolution TEXT,
  PRIMARY KEY (a_id, b_id),
  FOREIGN KEY (a_id) REFERENCES assertions (id),
  FOREIGN KEY (b_id) REFERENCES assertions (id)
);
```

### counterfactual_weights table

```sql
CREATE TABLE counterfactual_weights (
  assertion_id TEXT PRIMARY KEY,
  value REAL NOT NULL,
  computed_at TEXT NOT NULL,
  FOREIGN KEY (assertion_id) REFERENCES assertions (id)
);
```

---

## Error Handling

Common error patterns and recovery:

```javascript
try {
  ledger.createAssertion({...});
} catch (e) {
  if (e.message.includes('plane is required')) {
    console.error('Must specify which authority plane');
  } else if (e.message.includes('source_spans must be non-empty')) {
    console.error('Must provide at least one source for lineage');
  } else {
    console.error('Unknown error:', e.message);
  }
}
```

---

## JSON Schema

The assertion schema is defined in `schemas/assertion.schema.json` and used for validation.

Key constraints:
- `confidence`: [0.0, 1.0]
- `quorum_count`: [1, ∞)
- `status`: tentative | established | fossilized | quarantined
- `staleness_model`: flat | exponential | episodic | state_bound | contextual
- `class_`: monotonic | episodic | state_bound | contextual

---

## Performance Characteristics

| Operation | Complexity | Latency |
|-----------|------------|---------|
| createAssertion | O(s) | ~1ms (s = num sources) |
| reinforceAssertion | O(1) | ~0.5ms |
| queryActiveByPlane(limit=100) | O(limit log n) | ~5-10ms |
| rankActive(limit=100) | O(limit log n) | ~5-15ms |
| selectForContext(budget) | O(result count) | ~5ms |
| getAssertion | O(1) | ~0.5ms |
| queryTensions | O(n) | ~5ms (n = total assertions) |
| linkSupersession | O(1) | ~1ms |

---

## See Also

- [Ledger Guide](./LEDGER-GUIDE.md) — Tutorials and practical examples
- [HOW-IT-WORKS.md](../HOW-IT-WORKS.md) — Architecture and assertion ledger overview
- [tests/ledger.test.js](../tests/ledger.test.js) — 50+ runnable examples
- [tests/transform.test.js](../tests/transform.test.js) — Transform script examples
