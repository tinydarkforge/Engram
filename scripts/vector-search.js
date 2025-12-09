#!/usr/bin/env node

/**
 * Vector Search for Memex
 *
 * Semantic search using sentence embeddings (all-MiniLM-L6-v2)
 * - 384-dimensional embeddings
 * - Cosine similarity search
 * - Find sessions by meaning, not just keywords
 */

const fs = require('fs');
const path = require('path');
const { pipeline } = require('@huggingface/transformers');

const MEMEX_PATH = process.env.MEMEX_PATH || path.join(process.env.HOME, 'code/cirrus/DevOps/Memex');
const EMBEDDINGS_PATH = path.join(MEMEX_PATH, '.cache', 'embeddings.json');

class VectorSearch {
  constructor() {
    this.embedder = null;
    this.embeddings = null;
  }

  /**
   * Initialize the sentence transformer model
   * Uses all-MiniLM-L6-v2: 384 dimensions, optimized for semantic search
   */
  async initialize() {
    if (!this.embedder) {
      console.log('🧠 Loading embedding model (all-MiniLM-L6-v2)...');
      this.embedder = await pipeline(
        'feature-extraction',
        'Xenova/all-MiniLM-L6-v2'
      );
    }

    // Load cached embeddings if available
    this.loadEmbeddings();
  }

  /**
   * Generate embedding for a text
   * Returns 384-dimensional vector
   */
  async embed(text) {
    if (!this.embedder) {
      await this.initialize();
    }

    const output = await this.embedder(text, {
      pooling: 'mean',
      normalize: true
    });

    // Convert tensor to array
    return Array.from(output.data);
  }

  /**
   * Calculate cosine similarity between two vectors
   * Returns value between -1 and 1 (higher = more similar)
   */
  cosineSimilarity(a, b) {
    if (a.length !== b.length) {
      throw new Error('Vectors must have same length');
    }

    let dotProduct = 0;
    let magnitudeA = 0;
    let magnitudeB = 0;

    for (let i = 0; i < a.length; i++) {
      dotProduct += a[i] * b[i];
      magnitudeA += a[i] * a[i];
      magnitudeB += b[i] * b[i];
    }

    magnitudeA = Math.sqrt(magnitudeA);
    magnitudeB = Math.sqrt(magnitudeB);

    if (magnitudeA === 0 || magnitudeB === 0) {
      return 0;
    }

    return dotProduct / (magnitudeA * magnitudeB);
  }

  /**
   * Load cached embeddings from disk
   */
  loadEmbeddings() {
    if (fs.existsSync(EMBEDDINGS_PATH)) {
      try {
        this.embeddings = JSON.parse(fs.readFileSync(EMBEDDINGS_PATH, 'utf8'));
        return this.embeddings;
      } catch (e) {
        console.warn('⚠️  Failed to load embeddings cache:', e.message);
        this.embeddings = { sessions: {}, version: '1.0.0' };
      }
    } else {
      this.embeddings = { sessions: {}, version: '1.0.0' };
    }
    return this.embeddings;
  }

  /**
   * Save embeddings to disk
   */
  saveEmbeddings() {
    if (!this.embeddings) return;

    const cacheDir = path.dirname(EMBEDDINGS_PATH);
    if (!fs.existsSync(cacheDir)) {
      fs.mkdirSync(cacheDir, { recursive: true });
    }

    fs.writeFileSync(EMBEDDINGS_PATH, JSON.stringify(this.embeddings, null, 2));
  }

  /**
   * Generate embedding for a session
   * Combines summary, topics, and key decisions into searchable text
   */
  async embedSession(sessionData) {
    // Combine relevant fields for embedding
    const text = [
      sessionData.summary || '',
      (sessionData.topics || []).join(' '),
      (sessionData.key_decisions || []).map(d => d.decision).join(' ')
    ].join(' ').trim();

    if (!text) {
      return null;
    }

    const embedding = await this.embed(text);

    return {
      id: sessionData.id,
      embedding,
      text_preview: text.substring(0, 100)
    };
  }

  /**
   * Calculate decay factor based on session age
   * Uses exponential decay: score * decay_rate^days_old
   *
   * @param {string} sessionId - Session ID (format: xx-YYYY-MM-DD-slug)
   * @param {number} decayRate - Daily decay rate (default 0.98 = 2% per day)
   * @param {number} halfLifeDays - Alternative: specify half-life in days
   * @returns {number} Decay multiplier between 0 and 1
   */
  calculateDecay(sessionId, options = {}) {
    const { decayRate = 0.98, halfLifeDays = null, maxAgeDays = 365 } = options;

    // Extract date from session ID (format: xx-YYYY-MM-DD-slug)
    const dateMatch = sessionId.match(/(\d{4}-\d{2}-\d{2})/);
    if (!dateMatch) return 1.0; // No decay if can't parse date

    const sessionDate = new Date(dateMatch[1]);
    const now = new Date();
    const daysOld = Math.floor((now - sessionDate) / (1000 * 60 * 60 * 24));

    if (daysOld <= 0) return 1.0; // Today's sessions get full weight
    if (daysOld > maxAgeDays) return 0.1; // Floor for very old sessions

    // Calculate decay rate from half-life if provided
    // half-life formula: 0.5 = rate^halfLifeDays, so rate = 0.5^(1/halfLifeDays)
    const effectiveRate = halfLifeDays
      ? Math.pow(0.5, 1 / halfLifeDays)
      : decayRate;

    return Math.pow(effectiveRate, daysOld);
  }

  /**
   * Calculate keyword match score for hybrid search
   * Returns a score between 0 and 1 based on keyword overlap
   *
   * @param {string} query - The search query
   * @param {string} text - The text to search in
   * @returns {number} Score between 0 and 1
   */
  keywordScore(query, text) {
    if (!query || !text) return 0;

    const queryLower = query.toLowerCase();
    const textLower = text.toLowerCase();

    // Extract meaningful words (3+ chars, no common stop words)
    const stopWords = new Set(['the', 'and', 'for', 'with', 'this', 'that', 'from', 'have', 'was', 'are', 'been']);
    const queryWords = queryLower
      .split(/\s+/)
      .filter(w => w.length >= 3 && !stopWords.has(w));

    if (queryWords.length === 0) return 0;

    let matchCount = 0;
    let exactPhraseBonus = 0;

    // Check for exact phrase match (big bonus)
    if (textLower.includes(queryLower)) {
      exactPhraseBonus = 0.3;
    }

    // Check individual word matches
    for (const word of queryWords) {
      if (textLower.includes(word)) {
        matchCount++;
      }
    }

    // Base score is ratio of matched words
    const baseScore = matchCount / queryWords.length;

    // Combine: base score + exact phrase bonus, capped at 1
    return Math.min(1, baseScore + exactPhraseBonus);
  }

  /**
   * Search sessions by semantic similarity
   * Returns ranked results with similarity scores
   *
   * @param {string} query - Search query
   * @param {object} options - Search options
   * @param {number} options.limit - Max results (default 10)
   * @param {number} options.minSimilarity - Min similarity threshold (default 0.2)
   * @param {boolean} options.useDecay - Apply time decay (default true)
   * @param {number} options.decayRate - Daily decay rate (default 0.98)
   * @param {number} options.halfLifeDays - Half-life in days (overrides decayRate)
   * @param {boolean} options.hybrid - Enable hybrid search (default true)
   * @param {number} options.keywordWeight - Weight for keyword score (default 0.3)
   */
  async search(query, options = {}) {
    const {
      limit = 10,
      minSimilarity = 0.2,
      includeScores = true,
      useDecay = true,
      decayRate = 0.98,
      halfLifeDays = null,
      hybrid = true,
      keywordWeight = 0.3
    } = options;

    // Load embeddings if not already loaded
    if (!this.embeddings) {
      this.loadEmbeddings();
    }

    if (!this.embeddings || Object.keys(this.embeddings.sessions).length === 0) {
      return {
        query,
        results: [],
        message: 'No embeddings available. Generate embeddings first.'
      };
    }

    // Generate query embedding
    const queryEmbedding = await this.embed(query);

    // Calculate similarity with all sessions
    const results = [];

    for (const [sessionId, sessionData] of Object.entries(this.embeddings.sessions)) {
      if (!sessionData.embedding) continue;

      const semanticScore = this.cosineSimilarity(queryEmbedding, sessionData.embedding);

      // Hybrid: combine semantic + keyword scores
      let combinedScore = semanticScore;
      let keywordScoreVal = 0;

      if (hybrid && sessionData.text_preview) {
        keywordScoreVal = this.keywordScore(query, sessionData.text_preview);
        // Weighted combination: (1-w)*semantic + w*keyword
        combinedScore = (1 - keywordWeight) * semanticScore + keywordWeight * keywordScoreVal;
      }

      // Apply time decay if enabled
      let finalScore = combinedScore;
      let decayFactor = 1.0;

      if (useDecay) {
        decayFactor = this.calculateDecay(sessionId, { decayRate, halfLifeDays });
        finalScore = combinedScore * decayFactor;
      }

      if (finalScore >= minSimilarity) {
        results.push({
          session_id: sessionId,
          similarity: Math.round(semanticScore * 100) / 100,
          keyword: hybrid ? Math.round(keywordScoreVal * 100) / 100 : undefined,
          score: Math.round(finalScore * 100) / 100,
          decay: Math.round(decayFactor * 100) / 100,
          text_preview: sessionData.text_preview
        });
      }
    }

    // Sort by final score (with decay applied)
    results.sort((a, b) => b.score - a.score);

    // Limit results
    const limitedResults = results.slice(0, limit);

    return {
      query,
      results: limitedResults,
      total_matches: results.length,
      showing: limitedResults.length,
      decay_enabled: useDecay,
      hybrid_enabled: hybrid
    };
  }

  /**
   * Generate embeddings for all sessions in Memex
   * Uses parallel processing for 10x speed improvement
   */
  async generateAllEmbeddings() {
    console.log('🔍 Finding all sessions...');

    const { glob } = require('glob');
    const sessionFiles = await glob('summaries/projects/*/sessions-index.json', {
      cwd: MEMEX_PATH
    });

    // Collect all sessions that need embedding
    const sessionsToEmbed = [];
    let totalSessions = 0;

    for (const file of sessionFiles) {
      const fullPath = path.join(MEMEX_PATH, file);
      const sessionsIndex = JSON.parse(fs.readFileSync(fullPath, 'utf8'));

      if (!sessionsIndex.sessions) continue;

      for (const session of sessionsIndex.sessions) {
        totalSessions++;

        // Skip if already embedded (unless force regenerate)
        if (!this.embeddings.sessions[session.id]) {
          sessionsToEmbed.push(session);
        }
      }
    }

    console.log(`📊 Found ${totalSessions} total sessions, ${sessionsToEmbed.length} need embedding`);

    if (sessionsToEmbed.length === 0) {
      console.log('✅ All sessions already embedded');
      return {
        total_sessions: totalSessions,
        embedded: 0,
        cached: totalSessions,
        embeddings_file: EMBEDDINGS_PATH
      };
    }

    // Process in parallel batches for optimal performance
    const BATCH_SIZE = 10; // Process 10 sessions at a time
    let embeddedCount = 0;
    const startTime = Date.now();

    for (let i = 0; i < sessionsToEmbed.length; i += BATCH_SIZE) {
      const batch = sessionsToEmbed.slice(i, i + BATCH_SIZE);

      // Process batch in parallel
      const results = await Promise.allSettled(
        batch.map(session => this.embedSession(session))
      );

      // Collect successful embeddings
      results.forEach((result, idx) => {
        if (result.status === 'fulfilled' && result.value) {
          const session = batch[idx];
          this.embeddings.sessions[session.id] = result.value;
          embeddedCount++;
        } else if (result.status === 'rejected') {
          console.warn(`  ⚠️  Failed to embed ${batch[idx].id}:`, result.reason?.message);
        }
      });

      // Progress update
      console.log(`  ✓ Embedded ${embeddedCount}/${sessionsToEmbed.length} sessions (${Math.round(embeddedCount/sessionsToEmbed.length*100)}%)`);

      // Save periodically (every 50 sessions)
      if (embeddedCount % 50 === 0) {
        this.saveEmbeddings();
      }
    }

    // Final save
    this.saveEmbeddings();

    const duration = ((Date.now() - startTime) / 1000).toFixed(1);
    const rate = (embeddedCount / (Date.now() - startTime) * 1000).toFixed(1);

    console.log(`✅ Completed in ${duration}s (${rate} sessions/sec)`);

    return {
      total_sessions: totalSessions,
      embedded: embeddedCount,
      cached: totalSessions - embeddedCount,
      embeddings_file: EMBEDDINGS_PATH,
      duration_seconds: parseFloat(duration),
      rate_per_second: parseFloat(rate)
    };
  }

  /**
   * Get embedding statistics
   */
  getStats() {
    if (!this.embeddings) {
      this.loadEmbeddings();
    }

    const embeddedCount = Object.keys(this.embeddings.sessions).length;
    const fileSize = fs.existsSync(EMBEDDINGS_PATH)
      ? fs.statSync(EMBEDDINGS_PATH).size
      : 0;

    return {
      total_embeddings: embeddedCount,
      file_size_kb: Math.round(fileSize / 1024),
      avg_size_per_embedding_bytes: embeddedCount > 0 ? Math.round(fileSize / embeddedCount) : 0,
      embedding_dimensions: 384,
      model: 'all-MiniLM-L6-v2',
      cache_path: EMBEDDINGS_PATH
    };
  }

  /**
   * Find duplicate/similar sessions across all embeddings
   * Compares every session pair and returns those above threshold
   *
   * @param {object} options
   * @param {number} options.threshold - Minimum similarity to consider duplicate (default 0.85)
   * @param {number} options.limit - Max pairs to return (default 20)
   * @returns {Array<{session1, session2, similarity}>}
   */
  findDuplicates(options = {}) {
    const { threshold = 0.85, limit = 20 } = options;

    if (!this.embeddings) {
      this.loadEmbeddings();
    }

    const sessionIds = Object.keys(this.embeddings.sessions);
    const duplicates = [];

    // Compare all pairs (O(n²) but n is small)
    for (let i = 0; i < sessionIds.length; i++) {
      for (let j = i + 1; j < sessionIds.length; j++) {
        const id1 = sessionIds[i];
        const id2 = sessionIds[j];

        const emb1 = this.embeddings.sessions[id1]?.embedding;
        const emb2 = this.embeddings.sessions[id2]?.embedding;

        if (!emb1 || !emb2) continue;

        const similarity = this.cosineSimilarity(emb1, emb2);

        if (similarity >= threshold) {
          duplicates.push({
            session1: {
              id: id1,
              preview: this.embeddings.sessions[id1].text_preview
            },
            session2: {
              id: id2,
              preview: this.embeddings.sessions[id2].text_preview
            },
            similarity: Math.round(similarity * 100) / 100
          });
        }
      }
    }

    // Sort by similarity descending
    duplicates.sort((a, b) => b.similarity - a.similarity);

    return {
      threshold,
      total_pairs_checked: (sessionIds.length * (sessionIds.length - 1)) / 2,
      duplicates_found: duplicates.length,
      duplicates: duplicates.slice(0, limit)
    };
  }

  /**
   * Find sessions similar to a specific session
   *
   * @param {string} sessionId - The session to find similar ones for
   * @param {object} options
   * @param {number} options.limit - Max results (default 5)
   * @param {number} options.minSimilarity - Minimum similarity (default 0.5)
   */
  findSimilarTo(sessionId, options = {}) {
    const { limit = 5, minSimilarity = 0.5 } = options;

    if (!this.embeddings) {
      this.loadEmbeddings();
    }

    const targetSession = this.embeddings.sessions[sessionId];
    if (!targetSession?.embedding) {
      return { error: `Session ${sessionId} not found or has no embedding` };
    }

    const results = [];

    for (const [id, data] of Object.entries(this.embeddings.sessions)) {
      if (id === sessionId || !data.embedding) continue;

      const similarity = this.cosineSimilarity(targetSession.embedding, data.embedding);

      if (similarity >= minSimilarity) {
        results.push({
          session_id: id,
          similarity: Math.round(similarity * 100) / 100,
          text_preview: data.text_preview
        });
      }
    }

    results.sort((a, b) => b.similarity - a.similarity);

    return {
      source_session: sessionId,
      source_preview: targetSession.text_preview,
      similar_sessions: results.slice(0, limit)
    };
  }
}

// CLI Usage
if (require.main === module) {
  const vectorSearch = new VectorSearch();
  const command = process.argv[2];

  (async () => {
    try {
      switch (command) {
        case 'generate':
          console.log('🧠 Generating embeddings for all sessions...');
          await vectorSearch.initialize();
          const result = await vectorSearch.generateAllEmbeddings();
          console.log('\n✅ Embeddings generated');
          console.log(`   • Total sessions: ${result.total_sessions}`);
          console.log(`   • Newly embedded: ${result.embedded}`);
          console.log(`   • From cache: ${result.cached}`);
          console.log(`   • Saved to: ${result.embeddings_file}`);
          break;

        case 'search':
          const query = process.argv.slice(3).join(' ');
          if (!query) {
            console.error('Usage: vector-search.js search <query>');
            process.exit(1);
          }

          console.log(`🔍 Searching for: "${query}"\n`);
          await vectorSearch.initialize();
          const searchResult = await vectorSearch.search(query);

          if (searchResult.results.length === 0) {
            console.log('❌ No results found');
          } else {
            console.log(`✅ Found ${searchResult.showing} results (${searchResult.total_matches} total):\n`);
            searchResult.results.forEach((r, i) => {
              console.log(`${i + 1}. [${(r.similarity * 100).toFixed(1)}%] ${r.session_id}`);
              console.log(`   ${r.text_preview}...\n`);
            });
          }
          break;

        case 'stats':
          const stats = vectorSearch.getStats();
          console.log('📊 Vector Search Stats:');
          console.log(`   • Embeddings: ${stats.total_embeddings}`);
          console.log(`   • Cache size: ${stats.file_size_kb}KB`);
          console.log(`   • Avg per embedding: ${stats.avg_size_per_embedding_bytes} bytes`);
          console.log(`   • Dimensions: ${stats.embedding_dimensions}`);
          console.log(`   • Model: ${stats.model}`);
          break;

        case 'test':
          // Quick test
          console.log('🧪 Testing vector search...\n');
          await vectorSearch.initialize();

          const testText = 'authentication and security';
          console.log(`Generating embedding for: "${testText}"`);
          const testEmbedding = await vectorSearch.embed(testText);
          console.log(`✓ Generated ${testEmbedding.length}-dimensional vector`);
          console.log(`✓ First 5 values: [${testEmbedding.slice(0, 5).map(v => v.toFixed(4)).join(', ')}...]`);
          break;

        case 'duplicates': {
          const threshold = parseFloat(process.argv[3]) || 0.85;
          console.log(`🔍 Finding duplicate sessions (threshold: ${threshold * 100}%)...\n`);

          const dupResult = vectorSearch.findDuplicates({ threshold });

          console.log(`📊 Checked ${dupResult.total_pairs_checked.toLocaleString()} session pairs`);
          console.log(`🔗 Found ${dupResult.duplicates_found} potential duplicates\n`);

          if (dupResult.duplicates.length === 0) {
            console.log('✅ No duplicates found above threshold');
          } else {
            dupResult.duplicates.forEach((dup, i) => {
              console.log(`${i + 1}. ${(dup.similarity * 100).toFixed(0)}% similar:`);
              console.log(`   📄 ${dup.session1.id}`);
              console.log(`      ${dup.session1.preview}...`);
              console.log(`   📄 ${dup.session2.id}`);
              console.log(`      ${dup.session2.preview}...`);
              console.log('');
            });
          }
          break;
        }

        case 'similar': {
          const targetId = process.argv[3];
          if (!targetId) {
            console.error('Usage: vector-search.js similar <session-id>');
            process.exit(1);
          }

          console.log(`🔍 Finding sessions similar to: ${targetId}\n`);

          const simResult = vectorSearch.findSimilarTo(targetId);

          if (simResult.error) {
            console.error(`❌ ${simResult.error}`);
            process.exit(1);
          }

          console.log(`📄 Source: ${simResult.source_preview}...\n`);
          console.log(`Found ${simResult.similar_sessions.length} similar sessions:\n`);

          simResult.similar_sessions.forEach((s, i) => {
            console.log(`${i + 1}. [${(s.similarity * 100).toFixed(0)}%] ${s.session_id}`);
            console.log(`   ${s.text_preview}...\n`);
          });
          break;
        }

        default:
          console.log('Vector Search - Semantic search for Memex');
          console.log('');
          console.log('Usage: vector-search.js [command]');
          console.log('');
          console.log('Commands:');
          console.log('  generate          - Generate embeddings for all sessions');
          console.log('  search <query>    - Search sessions by meaning');
          console.log('  duplicates [0.85] - Find duplicate/similar sessions');
          console.log('  similar <id>      - Find sessions similar to a specific one');
          console.log('  stats             - Show embedding statistics');
          console.log('  test              - Test embedding generation');
      }
    } catch (error) {
      console.error('Error:', error.message);
      process.exit(1);
    }
  })();
}

module.exports = VectorSearch;
