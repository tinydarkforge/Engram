# What is Codicil?

> A simple guide to understanding Codicil - AI assistant's memory system.

---

## The Problem

Every time you start a new AI assistant session, AI assistant forgets everything from before. You have to explain the same things again and again:

- "What's our commit format?"
- "How do we deploy?"
- "What did we do last week?"
- "What are our coding standards?"

**This wastes time and tokens.**

---

## The Solution: Codicil

**Codicil is a "memory system" for AI assistant.**

Think of it like a notebook. Before Codicil, AI assistant woke up with amnesia every day. After Codicil, AI assistant reads the notebook first and knows the rules + history.

### What Codicil Does

1. **AGENTS.md files** - Instructions that AI assistant reads automatically when starting
   - `~/.agents/AGENTS.md` = Global rules (all projects)
   - `project/.agents/AGENTS.md` = Project-specific rules

2. **Session memory** - When we finish working, we save what we did to Codicil

3. **Smart search** - AI assistant can search past sessions to find how we solved problems before

---

## How It Works

### When You Start AI assistant Code

```
1. AI assistant wakes up
2. AI assistant reads ~/.agents/AGENTS.md (global rules)
3. AI assistant reads project/.agents/AGENTS.md (project rules)
4. NOW AI assistant is ready to help you
```

So when you ask something, AI assistant **already knows**:
- Commit format (`feat:`, `fix:`, etc.)
- Branch naming (`feature/`, `fix/`, etc.)
- Workflows (assign issues, update reports, etc.)
- Project info (URLs, how to deploy, tech stack)

### Simple Diagram

```
┌─────────────────────────────────────────┐
│           YOU START CLAUDE              │
└─────────────────┬───────────────────────┘
                  ▼
┌─────────────────────────────────────────┐
│  📖 Reads AGENTS.md files automatically │  ← Always happens
└─────────────────┬───────────────────────┘
                  ▼
┌─────────────────────────────────────────┐
│  🧠 AI assistant now knows the rules          │
└─────────────────┬───────────────────────┘
                  ▼
┌─────────────────────────────────────────┐
│  💬 You ask a question                  │
└─────────────────────────────────────────┘
```

### What AI assistant Does NOT Read Automatically

The **session history** (past conversations) - AI assistant only searches those when you ask:

```bash
node ~/code/Codicil/scripts/neural-memory.js query "how did we fix X"
```

---

## Benefits & Gains

### 1. Token Savings

| Without Codicil | With Codicil |
|---------------|------------|
| Explain commit format every session (~100 tokens) | Already knows (0 tokens) |
| Explain project structure (~500 tokens) | Already knows (0 tokens) |
| Explain workflows (~200 tokens) | Already knows (0 tokens) |
| Explain deployment process (~300 tokens) | Already knows (0 tokens) |
| **~1,100 tokens wasted per session** | **~200 tokens (AGENTS.md load)** |

**Savings: ~900 tokens per session = ~80% reduction in repeated context**

Over 10 sessions = 9,000 tokens saved
Over 100 sessions = 90,000 tokens saved

### 2. Time Savings

| Task | Without Codicil | With Codicil |
|------|---------------|------------|
| Explain standards | 2-5 minutes | 0 minutes |
| Find past solution | 10-30 minutes searching | 30 seconds (neural search) |
| Onboard new AI assistant session | 5-10 minutes | Instant |
| Remember what we did last week | Manual notes | `remember` command |

**Average time saved: 15-30 minutes per session**

### 3. Consistency

| Without Codicil | With Codicil |
|---------------|------------|
| Different commit formats | Always `<type>(<scope>): <desc>` |
| Forget to assign issues | Always assign to maintainer |
| Inconsistent branch names | Always `feat/`, `fix/`, etc. |
| Miss steps in workflow | Workflow documented and followed |

### 4. Knowledge Preservation

- Sessions are saved with `remember` command
- Past solutions can be searched semantically
- Team knowledge is not lost when people forget
- New team members (or AI assistant sessions) can access history

---

## Quick Reference

### Save What You Did

```bash
~/code/Codicil/scripts/remember "what you did" --topics tag1,tag2
```

### Search Past Sessions

```bash
node ~/code/Codicil/scripts/neural-memory.js query "your question"
```

### Get Project Context

```bash
node ~/code/Codicil/scripts/neural-memory.js bundle <ProjectName>
```

### Deploy to All Repos

```bash
node ~/code/Codicil/scripts/deploy-neural.js
```

---

## Architecture

```
~/.agents/AGENTS.md                    ← Global rules (all projects)
~/code/<project>/.agents/AGENTS.md      ← Project-specific rules

~/code/Codicil/
├── .neural/
│   ├── embeddings.msgpack             # Sessions as vectors (for search)
│   ├── graph.msgpack                  # Concepts linked together
│   └── bundles/*.msgpack              # Pre-compiled contexts
├── docs/
│   └── WHAT-IS-CODICIL.md               # This file!
└── scripts/
    ├── neural-memory.js               # Build/query neural structures
    ├── deploy-neural.js               # Deploy to all repos
    └── remember                       # Save sessions
```

---

## Simple Analogy for Non-Technical People

> **Codicil is like giving AI assistant a company handbook.**
>
> Before: Every new employee (AI assistant session) starts on day 1 knowing nothing.
>
> After: Every new employee reads the handbook first and knows all the rules, processes, and even some history of past projects.

---

## Summary

| Aspect | Benefit |
|--------|---------|
| **Tokens** | ~80% reduction in repeated explanations |
| **Time** | 15-30 minutes saved per session |
| **Consistency** | Same standards every time |
| **Knowledge** | Nothing is lost, everything searchable |
| **Onboarding** | Instant context for new sessions |

---

*Last updated: December 11, 2025*
