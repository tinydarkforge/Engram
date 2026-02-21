# Memex + AgentBridge Strategy Note

## Executive Summary

Yes, Memex can be improved significantly.

Recommendation:
1. Keep Memex and AgentBridge as separate products.
2. Integrate them through a thin contract layer.
3. Share schemas and events, not a monolithic codebase.

## Honest Opinion

A full merge into one repository is likely to increase maintenance cost and reduce velocity.

Why:
1. Different core concerns:
   - Memex: memory indexing, retrieval, token efficiency.
   - AgentBridge: multi-agent messaging, transport, coordination.
2. Different runtime stacks:
   - Memex: Node.js ecosystem.
   - AgentBridge: Python/FastAPI/MCP stack.
3. Monolith risk:
   - Tighter coupling, harder releases, and more fragile dependency graph.

## Current State Assessment

### AgentBridge strengths
1. Clear service boundaries and transport model (MCP + HTTP + CLI).
2. Better reliability posture from tests (`../AgentBridge/tests/test_server.py`).
3. Practical ops features: auth token, heartbeat, backup, schema validation.

### Memex strengths
1. Strong core concept and cost/performance intent.
2. Useful memory architecture: index + lazy loading + bloom + semantic search.
3. Practical workflow integration via save/remember scripts.

### Memex gaps to address first
1. Product surface consistency issues:
   - Version/docs drift (`README.md` vs `package.json`).
   - Command naming drift (`remember` vs `recuerda`).
   - Script references drift (`remember.js` references where executable is `scripts/remember`).
2. Limited testing compared with feature surface.
3. Risky side effects in capture flow (implicit git commit behavior in `scripts/save-session.js`).
4. Schema/versioning discipline can be tightened across JSON/MessagePack/migration paths.

## Recommendation: Integrate, Don’t Merge

Build a thin interoperability layer:
1. Memex remains the knowledge/memory backend.
2. AgentBridge remains the communication/event backbone.
3. Integration via events + APIs.

This preserves separation of concerns while enabling shared value.

## Highest-Impact Memex Improvements (Priority)

1. Stabilize interface and docs
   - Align versioning across `README.md`, `package.json`, changelog, and startup output.
   - Standardize one capture command UX (`remember`) and deprecate aliases cleanly.
   - Fix docs that reference non-existent script names/paths.

2. Add test coverage for core behavior
   - `scripts/memex-loader.js`
   - `scripts/save-session.js`
   - `scripts/vector-search.js`
   - Add migration/compat tests for index/session formats.

3. Remove hidden side effects by default
   - Make git commit/push explicit opt-in flags.
   - Keep default behavior safe and local.

4. Harden schemas and compatibility
   - Define versioned schemas for index/session/event artifacts.
   - Validate at read/write boundaries.

5. Add observability
   - Track real token savings, cache hit ratio, latency percentiles, and failure rates.

## Proposed Integration Contract (Phase 1)

### Event: `memex.session.saved`

Producer: Memex
Consumer: AgentBridge subscribers

Payload fields:
1. `session_id`
2. `project`
3. `summary`
4. `topics[]`
5. `timestamp`
6. `artifacts[]` (optional)
7. `git` object (optional: branch, commit, files changed)

### Event: `memex.query.requested`

Producer: AgentBridge tools/agents
Consumer: Memex lookup endpoint/tool

Payload fields:
1. `query`
2. `project` (optional)
3. `limit`
4. `requester`

### Event: `memex.query.result`

Producer: Memex
Consumer: AgentBridge

Payload fields:
1. `query`
2. `results[]`
3. `latency_ms`
4. `source` (`keyword` | `semantic` | `hybrid`)

## Suggested 30-Day Plan

1. Week 1: Memex consistency pass
   - Fix docs/version/command naming drift.
   - Remove or gate implicit git side effects.

2. Week 2: Memex core tests
   - Add baseline test suite for loader, save, and search modules.

3. Week 3: Integration MVP
   - Emit `memex.session.saved` into AgentBridge.
   - Add AgentBridge command/tool to query Memex.

4. Week 4: Hardening
   - Add schema validation + error handling + perf metrics.

## Decision Framework (for merge vs integration)

Choose full merge only if all are true:
1. Single runtime stack is required.
2. Shared release cadence is mandatory.
3. Teams are blocked by repo split.
4. Operational burden is lower with one deployable.

Current evidence suggests these are not true right now.

## Final Recommendation

Do not merge repositories today.

Instead:
1. Keep Memex and AgentBridge independent.
2. Build a stable integration contract.
3. Raise Memex’s operational maturity (consistency + tests + safer defaults).

This yields faster progress with lower risk and preserves optionality for future architecture decisions.
