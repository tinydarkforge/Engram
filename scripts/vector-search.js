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
   * Search sessions by semantic similarity
   * Returns ranked results with similarity scores
   */
  async search(query, options = {}) {
    const {
      limit = 10,
      minSimilarity = 0.2,
      includeScores = true
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

      const similarity = this.cosineSimilarity(queryEmbedding, sessionData.embedding);

      if (similarity >= minSimilarity) {
        results.push({
          session_id: sessionId,
          similarity: Math.round(similarity * 100) / 100,
          text_preview: sessionData.text_preview
        });
      }
    }

    // Sort by similarity (highest first)
    results.sort((a, b) => b.similarity - a.similarity);

    // Limit results
    const limitedResults = results.slice(0, limit);

    return {
      query,
      results: limitedResults,
      total_matches: results.length,
      showing: limitedResults.length
    };
  }

  /**
   * Generate embeddings for all sessions in Memex
   */
  async generateAllEmbeddings() {
    console.log('🔍 Finding all sessions...');

    const { glob } = require('glob');
    const sessionFiles = await glob('summaries/projects/*/sessions-index.json', {
      cwd: MEMEX_PATH
    });

    let totalSessions = 0;
    let embeddedCount = 0;

    for (const file of sessionFiles) {
      const fullPath = path.join(MEMEX_PATH, file);
      const sessionsIndex = JSON.parse(fs.readFileSync(fullPath, 'utf8'));

      if (!sessionsIndex.sessions) continue;

      for (const session of sessionsIndex.sessions) {
        totalSessions++;

        // Skip if already embedded (unless force regenerate)
        if (this.embeddings.sessions[session.id]) {
          continue;
        }

        try {
          const embedding = await this.embedSession(session);

          if (embedding) {
            this.embeddings.sessions[session.id] = embedding;
            embeddedCount++;

            if (embeddedCount % 10 === 0) {
              console.log(`  ✓ Embedded ${embeddedCount}/${totalSessions} sessions...`);
            }
          }
        } catch (e) {
          console.warn(`  ⚠️  Failed to embed ${session.id}:`, e.message);
        }
      }
    }

    // Save embeddings
    this.saveEmbeddings();

    return {
      total_sessions: totalSessions,
      embedded: embeddedCount,
      cached: totalSessions - embeddedCount,
      embeddings_file: EMBEDDINGS_PATH
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

        default:
          console.log('Vector Search - Semantic search for Memex');
          console.log('');
          console.log('Usage: vector-search.js [command]');
          console.log('');
          console.log('Commands:');
          console.log('  generate       - Generate embeddings for all sessions');
          console.log('  search <query> - Search sessions by meaning');
          console.log('  stats          - Show embedding statistics');
          console.log('  test           - Test embedding generation');
      }
    } catch (error) {
      console.error('Error:', error.message);
      process.exit(1);
    }
  })();
}

module.exports = VectorSearch;
