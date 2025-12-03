# How Memex Saves Tokens

**The simple guide: 94-98% token savings**

---

## The Big Picture

**Without Memex:**
- Load all docs every time: 500KB
- Cost: ~50,000 tokens per query
- Monthly: ~$37/month

**With Memex:**
- Load tiny index: 4KB
- Cost: ~1,000 tokens per query
- Monthly: ~$2/month

**Savings: $35/month (94-98% reduction)** 💰

---

## How It Works: Three Smart Layers

Think of Memex like a **smart library** with three layers:

### 🚪 Layer 1: Bloom Filter (The Guard)

**Job:** Instant "NO" answers

```
You: "Did we work on elephants?"
Guard: "Nope, definitely not here!"
Time: 0.1ms | Cost: 0 tokens
```

- Size: 243 bytes (tiny!)
- Speed: 500-1000x faster than searching
- Accuracy: 100% for "NO" answers
- **Saves:** All wasteful file loading

### 📋 Layer 2: Index (The Catalog)

**Job:** Quick summaries without loading files

```
You: "What commit format do we use?"
Index: "Conventional Commits: <type>(<scope>): <description>"
Time: 2ms | Cost: 1,000 tokens
```

- Size: 4KB (vs 500KB docs)
- Contains: Topics, summaries, quick references
- **Answers 80% of questions** from index alone

### 📚 Layer 3: Full Details (The Books)

**Job:** Complete info only when asked

```
You: "Show me full details of session X"
Loads: Just that one session (586 bytes)
Time: 5ms | Cost: 1,150 tokens
```

- Lazy loaded: Only fetch when needed
- **Saves:** 64% vs loading everything upfront

---

## The Flow

```
Question → Bloom Filter → Index → Full Details
           ↓              ↓         ↓
           "NO!" (0 tok)  Summary   Complete
           ↓              (1K tok)  (1.1K tok)
           STOP           ↓
                         Usually enough!
```

**90% of queries stop at bloom filter or index** = Massive savings!

---

## Real Example

**Question:** "What's our commit format and show me docker work"

### Without Memex:
```
1. Load all docs (500KB)
2. Search everything
Total: 100,000 tokens
```

### With Memex:
```
1. Bloom filter: "commit" exists ✓, "docker" exists ✓
2. Load index (4KB): Get commit format from quick_ref
3. Load 2 docker sessions (1.2KB): Show details
Total: 1,300 tokens

Savings: 98,700 tokens (98.7%)
```

---

## Why Each Layer?

| Layer | Question It Answers | Speed | Tokens |
|-------|---------------------|-------|--------|
| Bloom Filter | "Is it NOT here?" | 0.1ms | 0 |
| Index | "What do we have?" | 2ms | 1,000 |
| Full Details | "Tell me everything" | 5ms | 1,150 |

**Key insight:** Most questions = "Do we have X?" (bloom filter) or "What is X?" (index)

Only deep dives need full details!

---

## Monthly Savings Calculator

**Your usage:**
- 100 Claude sessions/month
- 5 Memex queries per session
- = 500 queries/month

**Cost comparison:**

| | Without Memex | With Memex | Savings |
|---|---|---|---|
| Tokens/query | 25,000 | 1,500 | 94% |
| Total/month | 12.5M tokens | 750K tokens | 11.75M |
| Cost (Sonnet) | $37.50 | $2.25 | **$35.25** |

---

## Simple Analogy

**Bad library (no Memex):**
```
You: "Do you have a book on elephants?"
Librarian: *brings all 1000 books*
Librarian: *searches through them*
Librarian: "No, we don't."
```

**Smart library (Memex):**
```
You: "Do you have a book on elephants?"
Guard: "Nope!" (checked tiny list)
```

**Or if it exists:**
```
You: "What books on docker?"
Librarian: *opens catalog*
Librarian: "We have 4. Here are summaries."
You: "Show me #3"
Librarian: *gets just that one book*
```

---

## The Magic Numbers

✅ **98% savings** on startup (50K → 1K tokens)
✅ **100% savings** on negative queries (bloom filter)
✅ **97% savings** on focused queries (index only)
✅ **64% smaller** index (lazy loading)
✅ **37% smaller** files (MessagePack format)

**Combined: 94-98% total reduction** 🎯

---

## Bottom Line

Memex = A smart assistant who:
1. ✅ Knows what you DON'T have (bloom filter)
2. ✅ Knows what you DO have (index)
3. ✅ Fetches full details only when needed (lazy loading)

Instead of dumping everything every time! 📦→📋

---

## Learn More

- [PHASE-1-OPTIMIZATIONS.md](PHASE-1-OPTIMIZATIONS.md) - Technical details
- [QUICKSTART.md](QUICKSTART.md) - Get started in 5 minutes
- [README.md](README.md) - Complete guide
