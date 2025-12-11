# What is Memex?

> A simple guide to understanding Memex - Claude's memory system.

---

## The Problem

Every time you start a new Claude session, Claude forgets everything from before. You have to explain the same things again and again:

- "What's our commit format?"
- "How do we deploy?"
- "What did we do last week?"
- "What are our coding standards?"

**This wastes time and tokens.**

---

## The Solution: Memex

**Memex is a "memory system" for Claude.**

Think of it like a notebook. Before Memex, Claude woke up with amnesia every day. After Memex, Claude reads the notebook first and knows the rules + history.

### What Memex Does

1. **CLAUDE.md files** - Instructions that Claude reads automatically when starting
   - `~/.claude/CLAUDE.md` = Global rules (all projects)
   - `project/.claude/CLAUDE.md` = Project-specific rules

2. **Session memory** - When we finish working, we save what we did to Memex

3. **Smart search** - Claude can search past sessions to find how we solved problems before

---

## How It Works

### When You Start Claude Code

```
1. Claude wakes up
2. Claude reads ~/.claude/CLAUDE.md (global rules)
3. Claude reads project/.claude/CLAUDE.md (project rules)
4. NOW Claude is ready to help you
```

So when you ask something, Claude **already knows**:
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
│  📖 Reads CLAUDE.md files automatically │  ← Always happens
└─────────────────┬───────────────────────┘
                  ▼
┌─────────────────────────────────────────┐
│  🧠 Claude now knows the rules          │
└─────────────────┬───────────────────────┘
                  ▼
┌─────────────────────────────────────────┐
│  💬 You ask a question                  │
└─────────────────────────────────────────┘
```

### What Claude Does NOT Read Automatically

The **session history** (past conversations) - Claude only searches those when you ask:

```bash
node ~/code/cirrus/DevOps/Memex/scripts/neural-memory.js query "how did we fix X"
```

---

## Benefits & Gains

### 1. Token Savings

| Without Memex | With Memex |
|---------------|------------|
| Explain commit format every session (~100 tokens) | Already knows (0 tokens) |
| Explain project structure (~500 tokens) | Already knows (0 tokens) |
| Explain workflows (~200 tokens) | Already knows (0 tokens) |
| Explain deployment process (~300 tokens) | Already knows (0 tokens) |
| **~1,100 tokens wasted per session** | **~200 tokens (CLAUDE.md load)** |

**Savings: ~900 tokens per session = ~80% reduction in repeated context**

Over 10 sessions = 9,000 tokens saved
Over 100 sessions = 90,000 tokens saved

### 2. Time Savings

| Task | Without Memex | With Memex |
|------|---------------|------------|
| Explain standards | 2-5 minutes | 0 minutes |
| Find past solution | 10-30 minutes searching | 30 seconds (neural search) |
| Onboard new Claude session | 5-10 minutes | Instant |
| Remember what we did last week | Manual notes | `remember` command |

**Average time saved: 15-30 minutes per session**

### 3. Consistency

| Without Memex | With Memex |
|---------------|------------|
| Different commit formats | Always `<type>(<scope>): <desc>` |
| Forget to assign issues | Always assign to Pamperito74 |
| Inconsistent branch names | Always `feat/`, `fix/`, etc. |
| Miss steps in workflow | Workflow documented and followed |

### 4. Knowledge Preservation

- Sessions are saved with `remember` command
- Past solutions can be searched semantically
- Team knowledge is not lost when people forget
- New team members (or Claude sessions) can access history

---

## Quick Reference

### Save What You Did

```bash
~/code/cirrus/DevOps/Memex/scripts/remember "what you did" --topics tag1,tag2
```

### Search Past Sessions

```bash
node ~/code/cirrus/DevOps/Memex/scripts/neural-memory.js query "your question"
```

### Get Project Context

```bash
node ~/code/cirrus/DevOps/Memex/scripts/neural-memory.js bundle <ProjectName>
```

### Deploy to All Repos

```bash
node ~/code/cirrus/DevOps/Memex/scripts/deploy-neural.js
```

---

## Architecture

```
~/.claude/CLAUDE.md                    ← Global rules (all projects)
~/code/cirrus/X/.claude/CLAUDE.md      ← Project-specific rules

~/code/cirrus/DevOps/Memex/
├── .neural/
│   ├── embeddings.msgpack             # Sessions as vectors (for search)
│   ├── graph.msgpack                  # Concepts linked together
│   └── bundles/*.msgpack              # Pre-compiled contexts
├── docs/
│   └── WHAT-IS-MEMEX.md               # This file!
└── scripts/
    ├── neural-memory.js               # Build/query neural structures
    ├── deploy-neural.js               # Deploy to all repos
    └── remember                       # Save sessions
```

---

## Simple Analogy for Non-Technical People

> **Memex is like giving Claude a company handbook.**
>
> Before: Every new employee (Claude session) starts on day 1 knowing nothing.
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
