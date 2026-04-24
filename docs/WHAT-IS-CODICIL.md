# What is Codicil?

A plain-language guide to understanding Codicil.

---

## The Problem

Every AI coding session starts from zero. You re-explain commit format, deployment steps, past decisions, what broke last week. That repeated context costs tokens and time — and it's imprecise, because you can't always remember what's worth surfacing.

---

## What Codicil Does

**Codicil is a local memory and fact ledger for AI coding agents.**

It stores engineering sessions as structured records, ranks facts by how well-corroborated they are, detects contradictions, and feeds a token-budgeted slice of relevant context to Claude Code via MCP — automatically, on every query.

No account. No cloud. No telemetry. Files stay on your machine.

---

## How It Works

### 1. You save sessions

After finishing a feature, fixing a bug, or making an architectural decision:

```bash
./scripts/remember "Switched auth to PKCE flow — dropped implicit grant due to security audit" --topics auth,security,oauth
```

Or let git hooks capture it automatically on commit.

### 2. Codicil indexes and ranks what it knows

Sessions are indexed in a four-layer stack. Queries traverse layers in order, stopping as early as possible:

```
Bloom filter (243 bytes, 0.1ms)
  → "not known" = stop immediately, zero tokens consumed

Index (4 KB, ~10ms)
  → compact summaries — answers 80% of queries

Session detail (per-file, ~5ms)
  → full notes, diffs, topics

Assertion ledger (SQLite, 5–15ms)
  → structured facts with confidence, quorum, decay, contradiction state
```

Context is always packed to a caller-specified token budget. You control how much the agent gets.

### 3. Claude Code queries it automatically

Once connected via MCP, Claude Code uses Codicil tools transparently:

- `neural_search` — finds relevant past sessions by meaning
- `ledger_select_context` — pulls ranked facts into the current context budget
- `get_bundle` — loads pre-compiled project context
- `remember` — saves the current session

---

## The Assertion Ledger

Beyond session notes, Codicil maintains a fact database — the **assertion ledger**. Every claim has:

- **Confidence** `[0.0–1.0]` — starts uncertain, grows when multiple sessions corroborate it
- **Quorum** — count of independent sources that agree
- **Status** — `tentative → established → fossilized`
- **Decay model** — different fact types age differently (build status ≠ architecture decision)
- **Tension** — automatic contradiction detection; conflicting facts surface as alerts

When you ask "how does auth work here?", the ledger returns the highest-ranked, most-corroborated facts — not the most recent session dump.

---

## What You Get

| Without Codicil | With Codicil |
|----------------|--------------|
| Re-explain commit format every session | Claude already knows it |
| Re-explain deployment steps | Surfaced from past sessions |
| Contradictory context from stale notes | Contradiction detection flags it |
| No way to know which past sessions are relevant | Semantic search + confidence ranking |
| Context budget uncontrolled | Token-budgeted retrieval |

---

## Quick Reference

```bash
# Save a session
./scripts/remember "what you did" --topics tag1,tag2

# Semantic search
node scripts/codicil-loader.js semantic "how did we handle auth"

# Keyword search
node scripts/codicil-loader.js search "oauth"

# Dashboard
npm start  # http://127.0.0.1:3000/

# Ledger stats
npm run ledger:stats
```

Full reference: [`docs/CHEATSHEET.md`](./CHEATSHEET.md) · Architecture: [`HOW-IT-WORKS.md`](../HOW-IT-WORKS.md)

---

## Architecture in One Diagram

```
You work  →  remember / git-hook  →  session saved to summaries/
                                      ↓
                                   indexed (bloom + index.json)
                                      ↓
                                   facts extracted → assertion ledger (SQLite)

Claude queries  →  MCP tool call  →  bloom check (0 tokens if miss)
                                      ↓
                                   index scan (4 KB)
                                      ↓
                                   session detail (on demand)
                                      ↓
                                   ledger ranking (confidence × quorum × decay)
                                      ↓
                                   budget-packed context → Claude
```

---

*For the full technical deep dive, see [`HOW-IT-WORKS.md`](../HOW-IT-WORKS.md).*
