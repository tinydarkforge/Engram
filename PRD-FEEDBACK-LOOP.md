# Memex — Outcome Feedback Loop & UI Polish PRD

> Status: DRAFT — v1
> Date: 2026-04-19
> Owner: Pamperito74
> Depends on: Ledger phases 0–10 (complete)

---

## 1. Context

The ledger can now select a context budget of assertions for an agent on every turn (`ledger_select_context`). What it **cannot** do is learn from what happened next. Every ranking decision is made blind — decay curves and salience heuristics are tuned by intuition, not evidence.

This PRD closes that loop. It introduces a feedback signal that records which selected assertions actually influenced the agent's reply, stores it alongside the ledger, feeds it back into ranking, and exposes both the raw data and aggregate trends through a polished UI.

---

## 2. Goals & Non-goals

### Goals
- **G1.** Attribute every reply back to the assertions that were in context, with a per-assertion "used" score.
- **G2.** Make the signal **agent-agnostic** — works via MCP for any client (Claude, Cursor, custom agents), upgrades when the agent supports citations.
- **G3.** Feed the signal into `rank.js` so ranking improves with use.
- **G4.** Ship a dashboard (new) and polish the two existing graph views.
- **G5.** Provide both automated and human-in-the-loop signals without the human becoming a bottleneck.

### Non-goals
- Not an analytics product — no cohorting, funnels, or growth metrics.
- Not a replacement for the ledger's decay models — outcome data **tunes** decay, does not replace it.
- Not agent training — signal is only used for retrieval ranking, not to fine-tune any model.
- No multi-user auth in v1; single-developer assumption holds.

---

## 3. The Signal — Recommendation

### 3a. Recommendation: **hybrid, agent-agnostic, three-layer**

| Layer | Source | Always on? | Trustworthiness | Cost |
|---|---|---|---|---|
| **A. Post-hoc attribution** | Semantic similarity between rendered assertion and agent reply | Yes | Medium (proxy) | Low (reuses neural index) |
| **B. Explicit citation** | Agent emits stable `assertion_id` tags in reply | When supported | High | Medium (prompt + parse) |
| **C. User feedback** | Thumbs / correction in dashboard | Opportunistic | High (gold-standard) | High per-unit but sparse |

Every selected assertion gets a score from layer A. Layer B overrides A when present. Layer C is treated as labeled ground-truth and is weighted highest in rank training.

### 3b. Why hybrid and not pick-one

Developers and AI agents prefer different things:

- **Developers** prefer layer C — they trust human-labeled outcomes. But they will not label every response, so C alone is too sparse to drive ranking.
- **AI agents** are more reliable as evaluators than as self-reporters. Self-citation (layer B) works well for Claude and GPT-4 but degrades on smaller/older models, and both models are known to hallucinate citations. Post-hoc (A) sidesteps this because it treats the reply as opaque text.
- **Industry pattern** (LangSmith, Phoenix, Ragas) converges on exactly this stack: automated attribution as backbone, citations when available, human labels as calibration.

### 3c. Why agent-agnostic, not Claude-only

- Memex's moat is **the memory layer**, not any specific client. Binding feedback to Claude makes it a Claude plugin, not a memory system.
- The MCP server is already the abstraction seam. Feedback hooks live there — any MCP client inherits the benefit.
- Claude-specific features (citations API, extended thinking) become upgrade paths, not prerequisites.

**Decision:** agent-agnostic. Claude gets layer B "for free" via its native citation support; other agents fall back to A + C without code changes.

---

## 4. Data Model

New table, additive only:

```sql
CREATE TABLE assertion_outcomes (
  id             INTEGER PRIMARY KEY,
  assertion_id   INTEGER NOT NULL REFERENCES assertions(id) ON DELETE CASCADE,
  session_id     TEXT NOT NULL,
  selected_at    INTEGER NOT NULL,       -- unix ms, when ledger_select_context emitted it
  scored_at      INTEGER,                -- unix ms, when outcome was computed
  signal_source  TEXT NOT NULL,          -- 'post_hoc' | 'citation' | 'user'
  score          REAL NOT NULL,          -- 0.0–1.0
  note           TEXT,                   -- optional (user memo, citation span, etc.)
  agent_id       TEXT,                   -- 'claude', 'cursor', etc. — null = unknown
  reply_hash     TEXT                    -- SHA1 of reply text, for dedup
);

CREATE INDEX idx_outcomes_assertion ON assertion_outcomes(assertion_id);
CREATE INDEX idx_outcomes_session ON assertion_outcomes(session_id);
CREATE INDEX idx_outcomes_source ON assertion_outcomes(signal_source);
```

Multiple rows per assertion per session are expected (e.g., one `post_hoc` and one `user` for the same pick). Consumers aggregate by assertion.

---

## 5. Ingestion Pipeline

Five touchpoints, all inside `scripts/` — no client changes required.

1. **`ledger.selectContext()`** — when it emits a block, also write one `selection` row per assertion into a lightweight `selection_log` (session_id, assertion_id, selected_at). This is the join key for later scoring.
2. **`feedback/post-hoc.js` (new)** — after a reply is observed (see §5a), embed the reply, cosine against each selected assertion's rendered text, write one `assertion_outcomes` row per pick with `signal_source='post_hoc'`.
3. **`feedback/citation.js` (new)** — parse the reply for `[[A:<id>]]` tags (or Claude's native citation format). For each hit, upsert with `signal_source='citation'`, score = 1.0. On miss, no row (absence ≠ "unused" here).
4. **`feedback/user.js` (new)** — dashboard POSTs to `/api/feedback`; writes `signal_source='user'` with score ∈ {0.0, 0.5, 1.0} + optional note.
5. **`rank.js`** — on the next ranking pass, fold per-assertion aggregate scores into the salience prior with a small learned weight. Use exponentially-weighted moving average so recent outcomes matter more.

### 5a. How does a reply get observed?

Two paths, neither agent-specific:

- **MCP hook:** Memex adds an optional `ledger_report_outcome` tool. Agents that know about it call it; a small adapter for each agent framework fills the gap.
- **Session watcher:** `scripts/capture.js` already tails Claude session JSON. Extend it to detect reply boundaries and trigger `feedback/post-hoc.js` offline. This is the agent-agnostic fallback — works even when the agent is oblivious.

Prefer the session watcher as the default. The tool is an optional accelerator for well-behaved agents.

---

## 6. Ranking Integration

- `rank.js` today: salience = decay(t) × weight(class) × recency × novelty.
- New term: `× (1 + β · outcome_prior(assertion))` where `outcome_prior ∈ [-0.5, +0.5]`, initial β = 0.2.
- `outcome_prior` is an EWMA of layer C (weight 1.0), B (0.7), A (0.3) scores, centered at 0.5.
- β is tunable via config; default is conservative so ranking doesn't thrash before enough signal accumulates.

**Cold-start:** any assertion with < 5 outcome events uses `outcome_prior = 0` (neutral). Prevents early-run instability.

---

## 7. UI/UX

### 7a. New dashboard (`web/dashboard/`)

Extends the existing `web/` scaffolding (already has `index.html`, `app.js`, `style.css`).

**Screens:**

1. **Overview.** Today's selections, hit-rate trend (7d sparkline), assertions with highest/lowest outcome score, recent user feedback feed.
2. **Assertions browser.** Virtualized list. Columns: text preview, class, decay state, selections (N), used-rate (%), last seen, sparkline. Inline thumbs buttons write layer-C feedback. Row click → detail.
3. **Assertion detail.** Full text, lineage graph, outcome timeline (stacked by signal_source), related sessions, "promote" / "retire" actions.
4. **Session detail.** Timeline of context selected for a session, per-pick outcome badges, reply preview (if available), "why was this picked?" explainer.
5. **Settings.** β, layer weights, decay overrides, export / import.

**Design principles (WCAG 2.2 AA):**

- Keyboard-first. Every action reachable via keystroke; focus ring visible; `/` opens search; `j`/`k` navigate lists.
- Dark mode default, light mode toggle persisted in localStorage, system preference respected.
- No color-only signals — pair hue with icon/label (e.g., "decayed" gets both orange + a waning-moon glyph).
- Virtualize any list > 200 rows.
- Honor `prefers-reduced-motion` — disable sparkline animations.
- Text contrast ≥ 4.5:1, interactive target size ≥ 44×44px.

### 7b. Graph polish (`graph.html` + `graph-memex.html`)

**Important correction:** these are *not* duplicates.
- `graph.html` → cross-project view with a project selector.
- `graph-memex.html` → single-scope Memex concept map.
Two valid surfaces; keep both.

**First, share the chassis:**

- Rename for intent: `graph.html` → `graph-projects.html`, `graph-memex.html` → `graph-concepts.html`. Current names hide the distinction.
- Extract shared shell into `web/graph-shell.js` + `web/tokens.css`: vis-network config, header, legend, palette, pan/zoom/keyboard handlers. Both pages become thin data-providers on top of the shell.
- Add a cross-link nav in the header ("Projects ↔ Concepts") so they feel like one app with two modes.

**Then polish both (shared code, so this is one change):**

- Outcome-weighted edges: thicker line when two assertions co-fired in successful sessions.
- Node coloring: 5-stop scale from red (low outcome_prior) to green (high). Pair with shape variations for colorblind users.
- Hover preview card with assertion text + outcome sparkline.
- Click-through to dashboard assertion detail.
- Pan/zoom that remembers state across reloads.
- Keyboard: arrow keys pan, `+` / `-` zoom, `f` fit, `esc` clear selection.
- `prefers-reduced-motion` disables force-layout animation; static layout snapshot instead.

### 7c. Shared component language

`web/tokens.css` (colors, spacing, typography) is consumed by dashboard **and** both graph pages via the shared shell from §7b. Single source of truth for every UI surface; drift is prevented by construction, not by discipline.

---

## 8. Rollout — PR Roadmap

### PR 1 — Selection logging & schema
**Goal:** We record what got picked, without scoring anything yet.
- [ ] Migration: `assertion_outcomes` + `selection_log` tables.
- [ ] `ledger.selectContext()` writes `selection_log` rows.
- [ ] Unit tests: every select produces exactly N log rows.
- [ ] No behavior change for agents.

### PR 2 — Post-hoc scoring (layer A)
- [ ] `feedback/post-hoc.js` — embed reply, cosine against selected assertions.
- [ ] `scripts/capture.js` detects reply boundaries, triggers scoring.
- [ ] Smoke test: run a canned session, assert ≥ 1 outcome row per selected assertion.
- [ ] Latency budget: ≤ 200ms per reply at p95.

### PR 3 — Citation parsing (layer B)
- [ ] Render assertions with `[[A:<id>]]` suffix.
- [ ] `feedback/citation.js` — regex + Claude native-citation parser.
- [ ] Integration test with a mocked Claude reply containing citations.

### PR 4 — Dashboard MVP
- [ ] Overview + Assertions browser screens.
- [ ] `/api/feedback` endpoint (layer C).
- [ ] Tokens file + dark mode.
- [ ] Keyboard navigation + focus management.
- [ ] Axe accessibility audit passes at AA.

### PR 5 — Assertion detail + Session detail
- [ ] Outcome timeline chart.
- [ ] Lineage graph embed.
- [ ] "Why was this picked?" explainer reconstructs selection inputs.

### PR 6 — Graph shared-shell & polish
- [ ] Rename to `graph-projects.html` + `graph-concepts.html`; add redirects from old paths.
- [ ] Extract shared shell: `web/graph-shell.js` + `web/tokens.css` consumed by both pages.
- [ ] Cross-link nav in header (Projects ↔ Concepts).
- [ ] Outcome-weighted edges, node coloring, hover cards — implemented once in the shell.
- [ ] Reduced-motion + keyboard support.
- [ ] State persistence (pan/zoom/selection) per page, keyed by page id.

### PR 7 — Rank integration
- [ ] `rank.js` reads outcome_prior, applies β-weighted multiplier.
- [ ] Config exposes β, layer weights, cold-start threshold.
- [ ] Regression test: ranking stable on assertions with < 5 events.
- [ ] A/B harness: record ranking with and without prior for 7 days before flipping default.

### PR 8 — MCP `ledger_report_outcome` tool (optional path for agents)
- [ ] Tool schema, handler, smoke tests.
- [ ] Documented in README + CHEATSHEET.

---

## 9. Metrics

- **Coverage:** % of selected assertions with at least one outcome row within 5 min of selection. Target ≥ 90% after PR 2.
- **Hit-rate:** rolling 7d mean outcome score across all selections. Tracked, not targeted — it's diagnostic.
- **Rank lift:** once PR 7 ships, compare selection quality (measured by subsequent outcome score) with β=0 vs β=0.2. Target ≥ 5% improvement.
- **UI perf:** dashboard initial paint < 1.5s on a 10k-assertion ledger. Graph 60fps pan/zoom on 1k nodes.
- **Accessibility:** 0 axe violations at AA.

---

## 10. Risks & Open Questions

### Risks
- **Reward hacking of layer A.** Assertions that echo common phrases will score high without being useful. Mitigate by normalizing against a corpus baseline ("what would any assertion score against this reply?") and subtracting.
- **Feedback loop drift.** High-scoring assertions get selected more, score higher, compound. Mitigate with the cold-start neutral, conservative β, and periodic decay of the prior itself.
- **Privacy.** Replies may contain sensitive code/secrets. Scoring is local-only and nothing leaves the box, but persisted `reply_hash` + `note` must not embed full reply text.

### Open questions
- **Q1.** Do we need a "negative" layer-A signal (reply contradicts assertion) or is low score sufficient? Initial answer: low score is sufficient; revisit after 30 days of data.
- **Q2.** Should layer C feedback propagate to lineage ancestors of the assertion? Leaning no — would muddy provenance. Confirm with a usage sample.
- **Q3.** Is session watcher reliable enough to be the default, or should MCP tool be the default with watcher as fallback? Needs a week of real-use data before we decide.
- **Q4.** Graph surfaces: **resolved.** Keep both (`graph.html` = cross-project, `graph-memex.html` = concept map). Plan is to rename for intent and share the chassis via `web/graph-shell.js` + `web/tokens.css`, not consolidate.

---

## 11. Out-of-scope Follow-ups

- Multi-user feedback with author attribution.
- Exporting outcome data for external analysis tools.
- Automatic assertion pruning when prior drops below a threshold.
- Remote MCP server to serve the dashboard over a network.
