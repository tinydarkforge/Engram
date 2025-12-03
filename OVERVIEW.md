# Memex Overview

**One-page guide to understanding Memex**

---

## What is Memex?

**Extended Memory for Claude** - A knowledge system that saves 94-98% on Claude API tokens by loading tiny indexes instead of full documentation.

**Cost savings:** ~$35/month for typical usage

---

## How It Works (Simple)

Instead of loading all your docs every time (500KB = 50,000 tokens):

```
1. Load 243-byte bloom filter → "Does X exist?" → 90% say NO, stop here (0 tokens)
2. Load 4KB index → "What do we have?" → 80% get answer, stop here (1,000 tokens)
3. Load specific details → Only when needed (1,150 tokens)
```

**Result:** 1,000 tokens average vs 50,000 tokens = **98% savings**

---

## Three Smart Layers

| Layer | Size | Speed | What It Does |
|-------|------|-------|--------------|
| **Bloom Filter** | 243 bytes | 0.1ms | Instant "NO" answers |
| **Index** | 4KB | 2ms | Quick summaries, answers 80% of queries |
| **Full Details** | Per-file | 5ms | Complete info, loaded on-demand |

**Key:** Most queries stop at layer 1 or 2 = Massive savings!

---

## Quick Start

```bash
# 1. Test it works
cd ~/code/cirrus/DevOps/Memex
node scripts/memex-loader.js startup

# 2. Save your first session
./scripts/remember "Implemented feature X" --topics feature,x

# 3. Query anytime
node scripts/memex-loader.js quick "commit format"
```

**That's it!** See [QUICKSTART.md](QUICKSTART.md) for more details.

---

## Documentation Guide

**New to Memex?** Start here:
1. **[README.md](README.md)** - Overview and common usage
2. **[QUICKSTART.md](QUICKSTART.md)** - 5-minute setup guide
3. **[HOW-MEMEX-SAVES-TOKENS.md](HOW-MEMEX-SAVES-TOKENS.md)** - Why it's so efficient

**Want specifics?**
- **[PHASE-1-OPTIMIZATIONS.md](PHASE-1-OPTIMIZATIONS.md)** - Latest features (v3.3)
- **[ROADMAP-V4.md](ROADMAP-V4.md)** - Future plans
- **[HOW-IT-WORKS.md](HOW-IT-WORKS.md)** - Technical deep dive
- **[CHEATSHEET.md](CHEATSHEET.md)** - Command reference

---

## Key Features

### Phase 1 (v3.3 - Latest)
- ✅ **Lazy Loading**: 64% smaller index
- ✅ **Bloom Filters**: 500-1000x faster negative queries
- ✅ **Git Hooks**: Zero-effort session capture

### Core (v3.0-3.2)
- ✅ **Incremental Updates**: 100x faster (only load changed files)
- ✅ **Persistent Cache**: SQLite, survives restarts
- ✅ **Semantic Search**: AI-powered, find by meaning
- ✅ **MessagePack**: 37% smaller, 5x faster

---

## Common Commands

```bash
# Save sessions
./scripts/remember "Summary" --topics tag1,tag2
./scripts/remember --interactive

# Query
node scripts/memex-loader.js startup
node scripts/memex-loader.js quick "commit format"
node scripts/memex-loader.js search docker
node scripts/memex-loader.js semantic "auth work"  # AI-powered

# Phase 1 tools
node scripts/lazy-loader.js convert     # Enable lazy loading
node scripts/bloom-filter.js build      # Build bloom filter
scripts/git-hook-capture.sh install     # Auto-capture on commits
```

---

## Performance at a Glance

| Metric | Without Memex | With Memex |
|--------|---------------|------------|
| Tokens/query | 50,000 | 1,000 |
| Startup time | 1000ms | 46ms |
| Monthly cost | $37.50 | $2.25 |

**Savings:** 94-98% tokens, $35/month, 21x faster

---

## The Bottom Line

**Memex = Smart librarian:**
- 🚪 **Bloom filter:** "Don't even look, it's not here"
- 📋 **Index:** "Here's a summary from the catalog"
- 📚 **Full details:** "Let me get that specific book"

Instead of bringing you 1000 books every time you ask a question! 📦→📋

---

## Next Steps

1. ✅ Read [QUICKSTART.md](QUICKSTART.md) - Get started
2. ✅ Install git hooks - Auto-capture sessions
3. ✅ Start saving sessions - Build your knowledge base
4. ✅ Read [HOW-MEMEX-SAVES-TOKENS.md](HOW-MEMEX-SAVES-TOKENS.md) - Understand the magic

---

**Questions?** Check [README.md](README.md) or open an issue.
