# Memex v3.1

**Extended Memory for Claude - Ultra Token-Efficient Knowledge System**

> **v3.1.1 Update (2025-12-02):** Added persistent cache with SQLite! Cache survives restarts for 20% faster cold starts (52ms → 42ms). Cache auto-expires after 60 minutes with version-based invalidation.

> **v3.1 Update (2025-12-02):** Added MessagePack binary format support! 50% smaller files (7.1KB → 3.6KB) with automatic fallback to gzip/JSON. Run `npm run convert-msgpack` to enable.

> **v3.0 Update (2025-11-30):** Major performance leap! Async I/O (3-5x faster), gzip compression (67% smaller), smart caching with memoization, relevance-ranked search, and performance monitoring. See [OPTIMIZATIONS-V3.md](OPTIMIZATIONS-V3.md) for details.

> **v2.0 Update (2025-11-30):** 60-70% additional token reduction through abbreviated keys, structured JSON, and progressive disclosure. Index now 3-4KB (down from 8KB). All markdown converted to optimized JSON structures.

---

## What Makes This Efficient?

### 🚀 Speed
- **Persistent cache**: SQLite cache survives restarts (52ms → 42ms)
- **Index-first**: Load 1.9KB compressed (67% smaller than v2.0!)
- **On-demand content**: Load only what's needed (async/await, non-blocking)
- **Smart caching**: Persistent cache + LRU hot cache + memoization + warm cache
- **Startup time**: <42ms typical from cache, <52ms cold start

### 💾 Token Efficiency
- **80% of queries**: Answered from index alone (no file loading)
- **Quick refs**: Common info embedded in index
- **Progressive disclosure**: 3-level summaries (l1: 5 words, l2: 1 sentence, l3: detailed)
- **Structured data**: Optimized JSON with abbreviated keys + legend
- **Token reduction**: 95% vs traditional, 60-70% vs v1

### 🎯 How Claude Uses It

```
User: "What's our commit format?"

Claude process:
1. Check index.json quick_ref (5KB loaded)
2. Found: "Conventional Commits: <type>(<scope>): <description>"
3. Answer immediately
4. No additional files loaded ✅

Total tokens: ~500 (vs 50,000 loading full docs)
```

---

## Architecture

```
Memex/
│
├── index.json                      # 5-10KB - LOAD THIS FIRST
│   ├── Global standards (quick_ref)
│   ├── All projects (metadata)
│   └── Topics index
│
├── metadata/projects/              # 2-5KB per project
│   └── DemoProject.json        # Full project metadata
│
├── summaries/projects/             # Session summaries
│   └── DemoProject/
│       └── sessions-index.json     # All session metadata
│
├── content/                        # Full content (load on-demand)
│   ├── global/
│   │   └── commit-standards.md
│   └── projects/
│       └── DemoProject/
│           └── sessions/
│               └── 2025-11-29-oauth.md
│
└── scripts/
    ├── memex-loader.js        # Efficient loader
    └── recuerda.js                 # Save sessions
```

---

## Usage

### Install

```bash
cd ~/code/cirrus/DevOps/Memex/scripts
chmod +x *.js

# Add to PATH (optional)
echo 'export PATH="$PATH:$HOME/code/cirrus/DevOps/Memex/scripts"' >> ~/.zshrc
```

### Startup (Automatic)

```bash
cd ~/code/cirrus/DemoProject
claude

# Claude runs:
node Memex/scripts/memex-loader.js startup

# Output:
# ✅ Memex Ready (87ms)
#
# 📊 Context Loaded:
#   • Global Standards: 5
#   • Current Project: DemoProject
#   • Available Projects: 3
#   • Total Sessions: 142
```

### Query Memex

```bash
# Quick answer (from index only)
memex-loader.js quick "what's our commit format?"
# Returns: { format: "<type>(<scope>): <description>", ... }

# Search across projects
memex-loader.js search authentication
# Returns: [{ type: 'topic', projects: ['ProjectAuth'], ... }]

# List all projects
memex-loader.js list
# Returns: [{ name: 'DemoProject', tech_stack: [...], ... }]
```

### Save Session

```bash
# Quick save
recuerda.js "Implemented OAuth2 authentication" --topics auth,oauth,google

# Interactive mode
recuerda.js --interactive
# Prompts for summary, topics, and optional detailed notes
```

---

## Loading Strategy

### Phase 1: Index (Always)
```javascript
// Load index.json (~5KB)
const index = loadIndex();

// Now Claude knows:
// - All global standards (quick_ref)
// - All projects (metadata)
// - All topics
// - Session counts
```

### Phase 2: Project Detection
```javascript
// Auto-detect from:
// 1. git remote
// 2. package.json
// 3. directory name

const project = detectProject();
// → "DemoProject"
```

### Phase 3: Project Metadata
```javascript
// Load metadata/projects/DemoProject.json (~2KB)
const metadata = loadProjectMetadata(project);

// Now Claude knows:
// - Tech stack
// - Architecture
// - Conventions
// - Environments
```

### Phase 4: On-Demand Content
```javascript
// Only load full content when needed
if (needsDetailedInfo) {
  const content = loadContent('content/global/commit-standards.md');
}
```

**Total startup: 5KB + 2KB = 7KB (vs 500KB loading everything)**

---

## Query Optimization

### Example: "How do we handle authentication?"

**Old approach (inefficient):**
```
1. Load all files (500KB, 50,000 tokens)
2. Search through everything
3. Return answer
```

**New approach (efficient):**
```
1. Check index topics: "auth" → ProjectAuth has 12 sessions
2. Load sessions-index.json (~5KB)
3. Check summaries: "OAuth2 with Passport.js, JWT tokens..."
4. Is summary sufficient?
   → Yes: Answer from summary (no file loading!)
   → No: Load specific session file (~10KB)

Total: 10KB, 1,000 tokens (95% reduction)
```

---

## Session Storage

### Metadata (Always Available)
```json
{
  "id": "ct-2025-11-29-oauth",
  "project": "DemoProject",
  "date": "2025-11-29",
  "summary": "Implemented OAuth2 with Google provider using Passport.js",
  "topics": ["auth", "oauth", "google", "passport"],
  "key_decisions": [
    {
      "decision": "Use Passport.js for OAuth",
      "rationale": "Industry standard, well-maintained, supports multiple providers"
    }
  ],
  "code_changes": {
    "files_added": ["src/auth/oauth.strategy.ts"],
    "lines_added": 150
  }
}
```

### Full Content (On-Demand)
```markdown
# OAuth2 Implementation - 2025-11-29

## Context
User requested Google login for faster authentication...

[Full detailed content only loaded when needed]
```

---

## Performance Targets

| Operation | Target | Actual |
|-----------|--------|--------|
| Load index | <50ms | ~20ms |
| Detect project | <10ms | ~5ms |
| Load metadata | <50ms | ~15ms |
| Quick answer | <100ms | ~50ms |
| Full startup | <150ms | ~87ms |
| Search all projects | <200ms | ~120ms |

**Token usage:**
- Index-based query: 500-1,000 tokens
- With metadata: 2,000-3,000 tokens
- With full content: 10,000-15,000 tokens
- Old approach (load everything): 50,000+ tokens

**95% token reduction for most queries**

---

## Commands Reference

### For Claude

```javascript
// In Claude Code, these happen automatically:

// Startup
const memex = new Memex();
const context = memex.startup();
// → Full context in <100ms

// Quick query (80% of cases)
const answer = memex.quickAnswer("what's our branching strategy?");
// → Answered from index, no files loaded

// Search
const results = memex.search("authentication");
// → Search index, load content only if needed

// Load another project
const authProject = memex.loadProjectMetadata("ProjectAuth");
// → Cross-project context on-demand
```

### For Developers

```bash
# Save session
recuerda.js "Added rate limiting to API" --topics api,rate-limiting,redis

# Interactive save
recuerda.js --interactive

# Query from CLI
memex-loader.js quick "commit format"
memex-loader.js search oauth
memex-loader.js list
```

---

## File Size Comparison

**Old approach (load everything):**
```
Global standards: 50KB
Project context: 100KB
All sessions: 350KB
Total: 500KB = 50,000 tokens
```

**New approach (index-first):**
```
Index: 5KB = 500 tokens ✅
Project metadata: 2KB = 200 tokens ✅
Session summaries: 3KB = 300 tokens ✅
Total: 10KB = 1,000 tokens (typical query)

Full content only loaded when truly needed
```

---

## Benefits

✅ **95% token reduction** - Most queries use <1K tokens vs 50K
✅ **10x faster startup** - 87ms vs 1000ms
✅ **Cross-project queries** - Access any project's knowledge
✅ **Smart caching** - Hot/warm/cold tiers
✅ **Structured + Prose** - JSON for speed, Markdown for detail
✅ **Git-synced** - Auto-sync across machines
✅ **Scalable** - Handle 1000+ sessions efficiently

---

## Key Innovations

1. **Index-First Architecture**
   - Know everything without loading everything
   - Quick refs embedded in index for instant answers

2. **Tiered Loading**
   - Metadata → Summary → Full content
   - Progressive disclosure based on need

3. **Structured Metadata**
   - JSON for quick parsing
   - Markdown for human editing

4. **Smart Caching**
   - Hot cache: Last 10 items in memory
   - Warm cache: Last 100 items on disk
   - Cold storage: Fetch from git on-demand

5. **Semantic Organization**
   - Topics index for fast lookup
   - Related sessions linked
   - Cross-project references

---

## Next Steps

1. **Extract DemoProject standards** → Populate global/
2. **Add more projects** → ProjectAuth, etc.
3. **Start logging sessions** → Use `recuerda`
4. **Optional: Add embeddings** → Semantic search
5. **Optional: Build web UI** → Browse Memex visually

---

**Memex: Extended memory, optimized for efficiency** 🧠⚡
