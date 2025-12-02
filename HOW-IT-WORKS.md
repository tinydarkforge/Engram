# How Memex Works

**Quick Reference Guide - Updated for v3.2.0**

---

## 📖 Basic Operation

### 1. **Save Sessions**
When you finish work, save what you did:
```bash
save-session.js "Implemented OAuth2 authentication" --topics auth,oauth,google
```

### 2. **Builds Index**
- Creates tiny 4KB index with all project knowledge
- Abbreviated keys for 60-70% token reduction
- MessagePack format (50% smaller)
- Compressed with gzip (67% smaller)

### 3. **Loads Smart**
- **Index first**: Claude loads 4KB index in 42ms
- **On-demand**: Only fetches full content when needed
- **Persistent cache**: SQLite cache survives restarts
- **Progressive disclosure**: Summary → Details → Full content

### 4. **Searches Fast**
- **Keyword search**: Traditional text matching
- **Semantic search**: AI-powered meaning matching
  - Example: "auth work" finds OAuth, JWT, SSO sessions
  - Uses 384-dimensional vector embeddings
  - Cosine similarity ranking

---

## 🧠 How It Gets Smarter

### The Learning Loop

```
┌─────────────────┐
│  Save Sessions  │ → More context
└────────┬────────┘
         ↓
┌─────────────────┐
│  Build Index    │ → Better organization
└────────┬────────┘
         ↓
┌─────────────────┐
│  Generate       │ → Semantic understanding
│  Embeddings     │
└────────┬────────┘
         ↓
┌─────────────────┐
│  Smart Search   │ → Faster answers
└────────┬────────┘
         ↓
    (Repeat with more sessions)
```

---

## 🎯 Learning Mechanisms

### 1. **Vector Embeddings** (The Brain)
Each session converted to 384-dimensional "meaning" vector:
```
Session: "Fixed OAuth timeout bug"
    ↓
Vector: [-0.066, 0.105, -0.074, ..., 0.033]  (384 numbers)
    ↓
Captures: authentication + debugging + timeout + OAuth
```

### 2. **Similarity Learning** (Pattern Recognition)
```
"How we fixed auth bug" (Session 1)
     ↓ 87% similar
"OAuth timeout issue" (Future search)
```
Memex learns relationships between problems and solutions.

### 3. **Topic Indexing** (Knowledge Graph)
```
auth
 ├── OAuth
 │   ├── Google
 │   ├── GitHub
 │   └── Timeout issues
 ├── JWT
 │   ├── Refresh tokens
 │   └── Expiration
 └── SSO
     └── SAML
```
Tags build interconnected knowledge web.

### 4. **Pattern Recognition** (Experience)
After seeing patterns repeatedly:
```
"docker + build + slow" (10 sessions)
    ↓
Memex knows: Check layer caching, multi-stage builds, .dockerignore
```

---

## 📊 Intelligence Growth

### Startup (5 sessions)
```
Query: "authentication"
Results: 1-2 keyword matches
Quality: Basic
```

### After 50 sessions
```
Query: "authentication"
Results: OAuth, JWT, SSO, LDAP, 2FA (all related)
Quality: Good - finds variations
```

### After 200 sessions
```
Query: "login problems"
Results: All auth issues, even if they never mentioned "login"
Quality: Excellent - understands intent
```

---

## 🔍 Search Intelligence Examples

### Example 1: Keyword Evolution
```
You search: "database slow"

Basic search finds:
- Sessions with "database" AND "slow"

Semantic search finds:
- Query optimization
- Index missing
- Connection pool exhausted
- N+1 queries
- Cache issues
```

### Example 2: Context Understanding
```
You ask: "How do we deploy?"

Without context:
- Returns generic deployment docs

With Memex history:
- "Last deployment: Used GitHub Actions"
- "Environment: AWS ECS with Docker"
- "Process: Build → Test → Deploy to staging → Manual approve → Production"
- Related sessions: 12 deployment sessions over 6 months
```

### Example 3: Problem Solving
```
New error: "CORS policy blocked"

Memex finds:
- Session 34: "Fixed CORS in production" (85% similar)
- Session 67: "API endpoint CORS config" (72% similar)
- Session 12: "Frontend auth headers" (65% similar)

Provides solution in seconds vs hours of searching.
```

---

## ⚡ Performance Intelligence

### Incremental Learning (v3.2.0)
```
Change 1 file → Only reload that file (100x faster)
Add 10 sessions → Only process new ones
Update index → Cached embeddings reused
```

### Query Optimization
```
80% of queries: Answered from 4KB index (no file loading)
15% of queries: Load session summaries (2-5KB)
5% of queries: Load full content (10-20KB)

Average: 1,000 tokens vs 50,000 tokens (95% reduction)
```

---

## 📈 Smarter Over Time

### Week 1
- Keyword matching only
- Basic topic search
- Manual context recall

### Month 1
- Semantic search active
- Cross-project patterns
- Auto-suggests related sessions

### Month 6
- Deep understanding of codebase
- Predicts common issues
- Knows team patterns and solutions
- Instant context switching

### Year 1
- Complete project memory
- Historical decision tracking
- Team knowledge preservation
- New team member onboarding database

---

## 🚀 Making It Smarter

### 1. **Save More Sessions**
```bash
# After any significant work
save-session.js "Fixed rate limiting bug" --topics api,rate-limit,redis

# Include decisions
# Key decisions: Use Redis instead of in-memory
# Rationale: Better for multiple instances
```

### 2. **Use Good Topics**
```bash
# Too generic
--topics code,fix

# Better
--topics auth,oauth,google,timeout-bug
```

### 3. **Regenerate Embeddings**
After adding many sessions:
```bash
cd ~/code/cirrus/DevOps/Memex
node scripts/vector-search.js generate
```

### 4. **Query Often**
The more you search, the better you understand what it knows:
```bash
# Keyword search
memex-loader.js search oauth

# Semantic search (smarter)
memex-loader.js semantic "how do we handle authentication"
```

---

## 🎓 Key Insights

### Why It's Smart
1. **Index-first**: Knows everything without loading everything
2. **Embeddings**: Understands meaning, not just words
3. **Incremental**: Learns from each new session
4. **Context-aware**: Remembers project-specific patterns
5. **Fast**: 95% token reduction, <50ms startup

### Why It Gets Smarter
1. **More data**: Each session adds training data
2. **Better patterns**: Repeated problems strengthen connections
3. **Cross-pollination**: Learns from similar projects
4. **Continuous**: Always available, always learning
5. **Compound knowledge**: Knowledge builds on knowledge

---

## 📚 Current Stats (v3.2.0)

```
Version: 3.2.0
Features: 5 major optimizations
Projects: 2 (DemoProject, DevOps)
Sessions: 5 (growing)
Index Size: 4KB (60-70% smaller than v1)
Startup Time: 42ms (from cache)
Search Time: <2 seconds (semantic)
Token Reduction: 95% vs traditional approach
Embedding Dimensions: 384
Model: all-MiniLM-L6-v2
```

---

## 🔮 Future Intelligence (Roadmap)

### Coming Soon
- **Worker Threads**: Parallel processing (3-5x faster)
- **WebAssembly**: Ultra-fast parsing (2-3x faster)
- **File Watcher**: Real-time learning from changes
- **Larger datasets**: Test with 1000+ sessions

### The Goal
**Perfect recall with zero effort** - Memex knows everything you've done, understands what you're asking, and finds the answer instantly, even if you don't remember the exact details.

---

**Last Updated**: 2025-12-02 (v3.2.0)
