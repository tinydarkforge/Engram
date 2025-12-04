# Changelog

All notable changes to Memex will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/).

> **Note:** v3.3.0 is the first tagged release. Previous versions (1.0-3.2) are documented feature milestones with actual commits but were not tagged. All features and changes listed are real and verifiable in the git history and documentation (see OPTIMIZATIONS-V3.md).

---

## [4.0.0] - 2025-12-04

### 🚀 MessagePack Binary Serialization (Epic F1)

**Focus:** Complete implementation of MessagePack binary format for 44% smaller files and improved I/O performance.

### Added

- **MessagePack Binary Format** - Full implementation across all data files
  - `index.json` → `index.msgpack`: 54% size reduction (13.5KB → 6.2KB)
  - `sessions-index.json` → `.msgpack`: 40-45% reduction across all projects
  - Session detail files: 29% reduction average
  - **Total savings**: 44% overall (40.6KB → 22.6KB)

- **Migration Tooling** - Safe, reversible migration process
  - `scripts/migrate-to-msgpack.js` - Comprehensive migration tool
    - Dry-run mode for previewing changes
    - Rollback capability (< 5 minutes RTO, zero data loss)
    - Progress reporting and error handling
  - `scripts/validate-msgpack.js` - Comprehensive validation suite
    - Tests data integrity across all files (16 tests, all passing)
    - Validates loader and lazy-loader functionality
    - Calculates and reports size savings
  - `scripts/benchmark-msgpack.js` - Performance comparison tool
    - JSON vs MessagePack parse speed (100 iterations)
    - File size comparison with reduction percentages

- **Enhanced Lazy Loader** - MessagePack support in lazy loading
  - Updated `scripts/lazy-loader.js` to prefer MessagePack format
  - Automatic fallback to JSON if MessagePack unavailable
  - New command: `convert-msgpack` for session details
  - Tests: 9 session files converted successfully

- **Automatic Format Detection** - Smart loading with fallback chain
  - Tries formats in order: Cache → MessagePack → Gzip → JSON
  - No code changes needed in consuming applications
  - Backward compatible with JSON-only setups

### Changed

- **Memex Loader** - Already had MessagePack support (lines 86-99)
  - Confirmed working with new MessagePack files
  - Load time: 53ms with MessagePack format
  - Format preference: MessagePack > Gzip > JSON

### Documentation

- **MESSAGEPACK-MIGRATION.md** - Comprehensive migration guide
  - Step-by-step migration instructions
  - Performance benchmarks and analysis
  - Troubleshooting section
  - Rollback procedures
  - FAQ with common questions

- **README.md** - Updated to v4.0
  - Added MessagePack migration instructions
  - Updated file size statistics (44% reduction)
  - Added link to migration guide

### Performance Results

| Metric | Target | Achieved | Status |
|--------|--------|----------|--------|
| File size reduction | 30-40% | 44.3% | ✅ Exceeded |
| Parse time improvement | 4-5x | Varies* | ⚠️ Context-dependent |
| Data integrity | 100% | 100% | ✅ Perfect |
| Migration safety | Zero data loss | Zero data loss | ✅ Confirmed |

*Note: For small files (<50KB), JSON parsing may be faster due to V8 optimization, but the 44% size reduction provides significant benefits for disk I/O, network transfer, and memory caching. Absolute parsing difference (0.11ms) is negligible for Memex's use case.

### Migration

```bash
# Migrate to MessagePack
node scripts/migrate-to-msgpack.js migrate

# Verify integrity
node scripts/migrate-to-msgpack.js verify

# Rollback if needed
node scripts/migrate-to-msgpack.js rollback
```

See [MESSAGEPACK-MIGRATION.md](MESSAGEPACK-MIGRATION.md) for complete guide.

### Breaking Changes

None - Fully backward compatible. JSON files preserved as fallback.

---

## [3.4.0] - 2025-12-03

### 🔧 Polish & Production Readiness

**Focus:** Bug fixes, comprehensive testing, documentation improvements, and performance validation.

### Fixed
- **Project Detection Bug** - Fixed `remember` command project detection
  - Updated cache version from 3.1.0 to 3.3.0
  - Regenerated MessagePack index with Memex project
  - Fixed sessions-index.json structure (added `topics_index`)
  - All projects now detected correctly

### Added
- **Comprehensive Test Suites**
  - `scripts/test-bloom-filter.js` - 12 tests for bloom filter
    - Validates 0.99% false positive rate (within target)
    - Tests performance: 0.003ms average check time
    - Confirms size efficiency: 1.20 bytes/item
  - `scripts/test-lazy-loading.js` - 10 tests for lazy loading
    - Validates 61-77% size reduction
    - Tests memory savings: 60.7% with realistic usage
    - Confirms progressive disclosure works correctly

- **Performance Benchmarks**
  - `scripts/benchmark.js` - Comprehensive performance testing
  - Validated with 1000+ sessions
  - Results: 69.9% size reduction, 50% faster load times
  - Scalability tested up to 5000 sessions

- **Real-World Documentation Examples**
  - 7 comprehensive examples added to QUICKSTART.md
  - Bug fix workflow, feature implementation, optimization patterns
  - Cross-project learning, daily work patterns
  - Zero-effort auto-capture examples

### Changed
- **QUICKSTART.md** - Added real-world usage examples
- **Repository Cleanup** - Removed 8 obsolete docs (2,278 lines)
- **.gitignore** - Updated to exclude generated cache files

### Performance
- Benchmark results (1000 sessions):
  - Load time: 1-2ms (50% faster with lazy loading)
  - Search time: Sub-millisecond for most queries
  - Memory: 69.9% reduction (973 KB → 292 KB)
  - Bloom filter: 87 bytes for 36 topics

### Testing
- 22 total tests (12 bloom filter + 10 lazy loading)
- All tests passing ✅
- Performance validated at scale

---

## [3.3.0] - 2025-12-02

### 🎯 Phase 1 Optimizations - Quick Wins

**Major Update:** Three optimizations delivering 94-98% token savings and automated workflows.

### Added
- **#22: Lazy Loading** - 64% smaller index
  - `scripts/lazy-loader.js` - Convert, revert, stats, load commands
  - `loadSessionDetails()` and `listSessions()` methods in memex-loader
  - Session details split: lightweight index (213 bytes) + full details (586 bytes)

- **#27: Bloom Filters** - 500-1000x faster negative queries
  - `scripts/bloom-filter.js` - Build, test, check, stats commands
  - Instant "does not exist" answers (0.1ms vs 50-100ms)
  - 243 bytes for 101 terms, 0.03% false positive rate
  - Integrated into `memex.search()` for automatic optimization

- **#36: Git Hook Integration** - Zero-effort session capture
  - `scripts/git-hook-capture.sh` - Install/uninstall git hooks
  - Auto-capture sessions on every commit
  - Auto-detects topics from files and commit type
  - Runs in background (non-blocking)
  - `--auto` mode in remember script

- **Documentation**
  - `HOW-MEMEX-SAVES-TOKENS.md` - Simple token savings guide (195 lines)
  - `OVERVIEW.md` - One-page overview (150 lines)
  - `PHASE-1-OPTIMIZATIONS.md` - Phase 1 technical details (207 lines)

### Changed
- **README.md** - Streamlined to 273 lines (34% reduction), updated to v3.3
- **QUICKSTART.md** - Fixed script names (recuerda → remember)
- **ROADMAP-V4.md** - Marked Phase 1 complete
- Sessions storage - Converted to lazy loading format

### Performance
- Index size: 8KB → 4KB (50% reduction)
- Negative queries: 50-100ms → 0.1ms (1000x faster)
- Session capture: Manual → Automatic
- Monthly cost: $37.50 → $2.25 (~$35 savings)

### Migration
```bash
node scripts/lazy-loader.js convert    # Enable lazy loading
node scripts/bloom-filter.js build     # Build bloom filter
scripts/git-hook-capture.sh install    # Install git hooks (optional)
```

---

## [3.2.0] - 2025-12-02

### Added
- **Incremental Updates** - 100x faster updates
  - `scripts/manifest-manager.js` - File change tracking
  - Only loads changed files (5000ms → 50ms)
  - Manifest with SHA256 hashing

- **AI-Powered Semantic Search**
  - `scripts/vector-search.js` - Vector embeddings search
  - 384-dimensional embeddings (all-MiniLM-L6-v2)
  - Cosine similarity matching
  - Find sessions by meaning, not just keywords
  - Example: "auth work" finds OAuth, JWT, SSO sessions

### Performance
- Update time: 5000ms → 50ms (100x faster)
- Semantic search: <2 seconds across all sessions

---

## [3.1.1] - 2025-12-02

### Added
- **Persistent Cache with SQLite**
  - `scripts/persistent-cache.js` - SQLite-based caching
  - Cache survives restarts
  - TTL-based invalidation (60 minutes default)
  - Version-based cache busting
  - LRU eviction (max 1000 entries)

### Performance
- Cold start: 52ms → 42ms (20% faster)
- Cache hit rate: 92%

---

## [3.1.0] - 2025-12-02

### Added
- **MessagePack Binary Format Support**
  - 50% smaller files (7.1KB → 3.6KB)
  - 5x faster parsing than JSON
  - Automatic fallback to gzip/JSON
  - `scripts/convert-to-msgpack.js` utility

### Performance
- Index size: 7.1KB → 3.6KB (50% reduction)
- Parse speed: 5x faster than JSON

---

## [3.0.0] - 2025-11-30

### 🎯 Major Performance Leap

### Added
- **Async I/O** - 3-5x faster file operations
- **Gzip Compression** - 67% smaller files
- **Smart Caching** - Hot/warm/cold tiers with memoization
- **Relevance-Ranked Search** - Better search results
- **Performance Monitoring** - Built-in metrics

### Changed
- All file operations now async/await
- Index compressed with gzip (7.5KB → 1.9KB)
- Multi-tier caching system
  - Hot cache: Last 10 items in memory
  - Warm cache: Last 100 items on disk
  - Cold storage: Fetch from git on-demand

### Performance
- Startup: ~87ms typical, <100ms cold start
- Index size: 7.5KB → 1.9KB (67% smaller)
- File operations: 3-5x faster

---

## [2.0.0] - 2025-11-30

### 🎯 Major Token Optimization

### Added
- **Abbreviated Keys** - 60-70% token reduction
  - JSON with short keys + legend for human readability
  - Example: `"tp": 3` instead of `"total_projects": 3`

- **Structured JSON** - Optimized data structures
  - All markdown converted to JSON
  - Progressive disclosure (3 levels: l1, l2, l3)

- **Quick References** - Embedded in index
  - Common queries answered from index alone
  - No file loading needed for 80% of queries

### Changed
- Index size: 8KB → 3-4KB (50-60% reduction)
- All markdown files converted to optimized JSON
- Schema-based structure

### Performance
- Token reduction: 60-70% vs v1.0
- 95% vs traditional documentation loading

---

## [1.0.0] - 2025-11-29

### 🎯 Initial Release

### Added
- **Index-First Architecture**
  - Load 5KB index instead of 500KB docs
  - 95% token reduction

- **Three-Tier Knowledge System**
  - Global standards
  - Project-specific context
  - Cross-project references

- **Session Storage**
  - Save work sessions with `remember` command
  - Metadata + full content split
  - Topic-based organization

- **Auto-Detection**
  - Project detection from git remote
  - Directory-based fallback

- **Core Scripts**
  - `memex-loader.js` - Main loader
  - `save-session.js` - Session recording
  - `remember`, `learn`, `memex` - Command aliases

### Architecture
```
index.json (5KB) → metadata/ (2KB) → summaries/ → content/ (on-demand)
```

### Performance
- Startup: <150ms
- Token usage: 500-1,000 vs 50,000 (95% reduction)
- Cross-project queries supported

---

## Version Comparison

| Version | Key Feature | Token Savings | Index Size | Speed |
|---------|-------------|---------------|------------|-------|
| **3.3.0** | Lazy Loading + Bloom Filters | 94-98% | 4KB | 0.1ms negative queries |
| **3.2.0** | Incremental + Semantic Search | 95% | 3.6KB | 100x faster updates |
| **3.1.1** | Persistent Cache | 95% | 3.6KB | 20% faster startup |
| **3.1.0** | MessagePack | 95% | 3.6KB | 5x faster parsing |
| **3.0.0** | Async + Gzip | 95% | 1.9KB | 3-5x faster I/O |
| **2.0.0** | Abbreviated Keys | 95% | 3-4KB | Same |
| **1.0.0** | Index-First | 95% | 5KB | Baseline |

---

## Upgrade Guide

### From v3.2 to v3.3
```bash
# Enable Phase 1 optimizations
node scripts/lazy-loader.js convert
node scripts/bloom-filter.js build
scripts/git-hook-capture.sh install  # Optional
```

### From v3.1 to v3.2
```bash
# Generate manifest for incremental updates
node scripts/manifest-manager.js generate

# Generate embeddings for semantic search
node scripts/vector-search.js generate
```

### From v3.0 to v3.1
```bash
# Convert to MessagePack format
npm run convert-msgpack
```

---

## Breaking Changes

**None** - All versions are backward compatible with graceful degradation.

---

## Links

- **Repository:** https://github.com/Pamperito74/Memex
- **Releases:** https://github.com/Pamperito74/Memex/releases
- **Roadmap:** [ROADMAP-V4.md](ROADMAP-V4.md)
- **Documentation:** [README.md](README.md)

---

## Contributing

See [ROADMAP-V4.md](ROADMAP-V4.md) for planned features and how to contribute.
