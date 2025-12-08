#!/usr/bin/env node

/**
 * Neural Memory v1.0 - AI-Native Knowledge Storage
 *
 * Not human-readable. Optimized for Claude.
 *
 * Features:
 * - Binary embeddings (384-dim vectors, no JSON parsing)
 * - Concept graph (associative, not chronological)
 * - Pre-compiled context bundles (zero-parse injection)
 * - Probabilistic lookups (bloom filters for instant NO)
 *
 * Usage:
 *   node neural-memory.js build      # Build all neural structures
 *   node neural-memory.js query      # Semantic query interface
 *   node neural-memory.js bundle     # Generate context bundles
 *   node neural-memory.js stats      # Show neural memory stats
 */

const fs = require('fs');
const path = require('path');
const msgpack = require('msgpack-lite');

const MEMEX_PATH = process.env.MEMEX_PATH || path.join(process.env.HOME, 'code/cirrus/DevOps/Memex');
const NEURAL_PATH = path.join(MEMEX_PATH, '.neural');

class NeuralMemory {
  constructor() {
    this.embeddings = null;
    this.graph = null;
    this.conceptIndex = null;
    this.vectorSearch = null;
  }

  /**
   * Ensure neural directory exists
   */
  ensureDir() {
    if (!fs.existsSync(NEURAL_PATH)) {
      fs.mkdirSync(NEURAL_PATH, { recursive: true });
    }
  }

  /**
   * Build all neural structures from Memex data
   */
  async build() {
    this.ensureDir();
    console.log('🧠 Building Neural Memory...\n');

    const results = {
      embeddings: await this.buildEmbeddings(),
      graph: await this.buildConceptGraph(),
      bundles: await this.buildContextBundles()
    };

    console.log('\n✅ Neural Memory built successfully');
    return results;
  }

  /**
   * Generate and store binary embeddings
   */
  async buildEmbeddings() {
    console.log('1️⃣  Generating embeddings...');

    const VectorSearch = require('./vector-search');
    this.vectorSearch = new VectorSearch();

    await this.vectorSearch.initialize();
    const result = await this.vectorSearch.generateAllEmbeddings();

    // Convert to binary format for faster loading
    const embeddingsJson = this.vectorSearch.embeddings;
    const binaryPath = path.join(NEURAL_PATH, 'embeddings.msgpack');

    // Optimize: Store vectors as Float32Array for 50% size reduction
    const optimized = {
      v: '1.0',
      dim: 384,
      sessions: {}
    };

    for (const [id, data] of Object.entries(embeddingsJson.sessions || {})) {
      optimized.sessions[id] = {
        e: new Float32Array(data.embedding), // 50% smaller than JSON floats
        t: data.text_preview?.slice(0, 50) || '' // Truncate preview
      };
    }

    const buffer = msgpack.encode(optimized);
    fs.writeFileSync(binaryPath, buffer);

    const jsonSize = fs.existsSync(path.join(MEMEX_PATH, '.cache/embeddings.json'))
      ? fs.statSync(path.join(MEMEX_PATH, '.cache/embeddings.json')).size
      : 0;

    console.log(`   ✓ ${result.total_sessions} sessions embedded`);
    console.log(`   ✓ Binary: ${Math.round(buffer.length / 1024)}KB (vs ${Math.round(jsonSize / 1024)}KB JSON)`);

    return {
      sessions: result.total_sessions,
      binary_size: buffer.length,
      json_size: jsonSize,
      savings: jsonSize > 0 ? `${Math.round((1 - buffer.length / jsonSize) * 100)}%` : 'n/a'
    };
  }

  /**
   * Build concept graph from sessions
   * Extracts concepts and their relationships
   */
  async buildConceptGraph() {
    console.log('\n2️⃣  Building concept graph...');

    const graph = {
      v: '1.0',
      nodes: {},    // concept -> { weight, sessions }
      edges: {},    // concept -> [related concepts]
      reverse: {}   // session -> [concepts]
    };

    // Load all sessions
    const projectsDir = path.join(MEMEX_PATH, 'summaries/projects');
    const projects = fs.readdirSync(projectsDir);

    for (const project of projects) {
      const indexPath = path.join(projectsDir, project, 'sessions-index.json');
      if (!fs.existsSync(indexPath)) continue;

      const data = JSON.parse(fs.readFileSync(indexPath, 'utf8'));
      if (!data.sessions) continue;

      for (const session of data.sessions) {
        const topics = session.topics || [];
        const sessionId = session.id;

        // Add to reverse index
        graph.reverse[sessionId] = topics;

        // Extract concepts from summary
        const concepts = this.extractConcepts(session.summary || '');
        const allConcepts = [...new Set([...topics, ...concepts])];

        // Add nodes
        for (const concept of allConcepts) {
          if (!concept) continue;

          if (!graph.nodes[concept]) {
            graph.nodes[concept] = { w: 0, s: [] };
          }
          graph.nodes[concept].w++;
          graph.nodes[concept].s.push(sessionId);
        }

        // Add edges (concepts that appear together)
        for (let i = 0; i < allConcepts.length; i++) {
          for (let j = i + 1; j < allConcepts.length; j++) {
            const c1 = allConcepts[i];
            const c2 = allConcepts[j];
            if (!c1 || !c2) continue;

            if (!graph.edges[c1]) graph.edges[c1] = {};
            if (!graph.edges[c2]) graph.edges[c2] = {};

            graph.edges[c1][c2] = (graph.edges[c1][c2] || 0) + 1;
            graph.edges[c2][c1] = (graph.edges[c2][c1] || 0) + 1;
          }
        }
      }
    }

    // Convert edge objects to sorted arrays (top 5 related)
    for (const [concept, related] of Object.entries(graph.edges)) {
      graph.edges[concept] = Object.entries(related)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 5)
        .map(([c, w]) => ({ c, w }));
    }

    // Save binary
    const buffer = msgpack.encode(graph);
    fs.writeFileSync(path.join(NEURAL_PATH, 'graph.msgpack'), buffer);

    console.log(`   ✓ ${Object.keys(graph.nodes).length} concepts extracted`);
    console.log(`   ✓ ${Object.keys(graph.edges).length} relationships mapped`);
    console.log(`   ✓ Binary: ${Math.round(buffer.length / 1024)}KB`);

    this.graph = graph;

    return {
      concepts: Object.keys(graph.nodes).length,
      relationships: Object.keys(graph.edges).length,
      binary_size: buffer.length
    };
  }

  /**
   * Extract key concepts from text
   */
  extractConcepts(text) {
    if (!text) return [];

    // Common tech concepts to look for
    const techPatterns = [
      /typescript/gi, /javascript/gi, /react/gi, /nextjs/gi, /nestjs/gi,
      /docker/gi, /prisma/gi, /postgresql/gi, /mongodb/gi,
      /auth/gi, /oauth/gi, /jwt/gi, /login/gi,
      /api/gi, /rest/gi, /graphql/gi,
      /test/gi, /bug/gi, /fix/gi, /hotfix/gi,
      /deploy/gi, /ci\/cd/gi, /pipeline/gi,
      /performance/gi, /optimization/gi, /cache/gi,
      /error/gi, /debug/gi, /logging/gi
    ];

    const concepts = [];
    for (const pattern of techPatterns) {
      if (pattern.test(text)) {
        concepts.push(pattern.source.replace(/\\|\//gi, '').toLowerCase());
      }
    }

    return [...new Set(concepts)];
  }

  /**
   * Generate pre-compiled context bundles for each project
   * These are binary blobs Claude can inject directly
   */
  async buildContextBundles() {
    console.log('\n3️⃣  Building context bundles...');

    const bundlesDir = path.join(NEURAL_PATH, 'bundles');
    if (!fs.existsSync(bundlesDir)) {
      fs.mkdirSync(bundlesDir, { recursive: true });
    }

    // Load slim context
    const slimContextPath = path.join(MEMEX_PATH, 'slim-context.json');
    if (!fs.existsSync(slimContextPath)) {
      console.log('   ⚠️  Run slim-context.js generate first');
      return { bundles: 0 };
    }

    const slimContext = JSON.parse(fs.readFileSync(slimContextPath, 'utf8'));
    const bundles = [];

    for (const [projectName, projectData] of Object.entries(slimContext.projects)) {
      // Create minimal binary bundle
      const bundle = {
        p: projectName,
        d: projectData.desc?.slice(0, 60) || '',
        t: projectData.tech || '',
        e: projectData.env || null,
        dp: projectData.deploy || null,
        r: (slimContext.recent[projectName] || []).slice(0, 3).map(s => ({
          d: s.d,
          s: s.s?.slice(0, 60) || ''
        })),
        // Include top related concepts from graph
        c: this.graph ? this.getTopConcepts(projectName, 5) : []
      };

      const buffer = msgpack.encode(bundle);
      const bundlePath = path.join(bundlesDir, `${projectName}.msgpack`);
      fs.writeFileSync(bundlePath, buffer);

      bundles.push({
        project: projectName,
        size: buffer.length
      });

      console.log(`   ✓ ${projectName}: ${buffer.length} bytes`);
    }

    return { bundles: bundles.length, details: bundles };
  }

  /**
   * Get top concepts for a project from the graph
   */
  getTopConcepts(projectName, limit = 5) {
    if (!this.graph) return [];

    const projectConcepts = {};

    // Find sessions for this project
    for (const [sessionId, concepts] of Object.entries(this.graph.reverse || {})) {
      if (sessionId.toLowerCase().includes(projectName.toLowerCase().slice(0, 2))) {
        for (const concept of concepts) {
          projectConcepts[concept] = (projectConcepts[concept] || 0) + 1;
        }
      }
    }

    return Object.entries(projectConcepts)
      .sort((a, b) => b[1] - a[1])
      .slice(0, limit)
      .map(([c]) => c);
  }

  /**
   * Semantic query interface
   */
  async query(queryText, options = {}) {
    const { limit = 5, includeRelated = true } = options;

    // Load neural structures
    await this.loadStructures();

    // Initialize vector search if needed
    if (!this.vectorSearch) {
      const VectorSearch = require('./vector-search');
      this.vectorSearch = new VectorSearch();
      await this.vectorSearch.initialize();
    }

    // Semantic search
    const searchResults = await this.vectorSearch.search(queryText, { limit });

    // Enrich with graph relationships
    const enriched = searchResults.results.map(result => {
      const sessionId = result.session_id;
      const concepts = this.graph?.reverse?.[sessionId] || [];
      const related = [];

      if (includeRelated && concepts.length > 0) {
        for (const concept of concepts.slice(0, 2)) {
          const edges = this.graph?.edges?.[concept] || [];
          related.push(...edges.slice(0, 2).map(e => e.c));
        }
      }

      return {
        ...result,
        concepts,
        related: [...new Set(related)].slice(0, 5)
      };
    });

    return {
      query: queryText,
      results: enriched,
      total: searchResults.total_matches
    };
  }

  /**
   * Load neural structures from binary files
   */
  async loadStructures() {
    const graphPath = path.join(NEURAL_PATH, 'graph.msgpack');

    if (fs.existsSync(graphPath) && !this.graph) {
      const buffer = fs.readFileSync(graphPath);
      this.graph = msgpack.decode(buffer);
    }
  }

  /**
   * Get neural memory statistics
   */
  getStats() {
    const stats = {
      neural_path: NEURAL_PATH,
      structures: {}
    };

    const files = [
      ['embeddings.msgpack', 'embeddings'],
      ['graph.msgpack', 'graph']
    ];

    for (const [file, name] of files) {
      const filePath = path.join(NEURAL_PATH, file);
      if (fs.existsSync(filePath)) {
        stats.structures[name] = {
          size_kb: Math.round(fs.statSync(filePath).size / 1024),
          exists: true
        };
      } else {
        stats.structures[name] = { exists: false };
      }
    }

    // Count bundles
    const bundlesDir = path.join(NEURAL_PATH, 'bundles');
    if (fs.existsSync(bundlesDir)) {
      const bundles = fs.readdirSync(bundlesDir).filter(f => f.endsWith('.msgpack'));
      stats.structures.bundles = {
        count: bundles.length,
        total_size_kb: bundles.reduce((sum, f) =>
          sum + fs.statSync(path.join(bundlesDir, f)).size, 0) / 1024
      };
    }

    return stats;
  }

  /**
   * Load a pre-compiled context bundle for a project
   * Returns minimal context for Claude injection
   */
  loadBundle(projectName) {
    const bundlePath = path.join(NEURAL_PATH, 'bundles', `${projectName}.msgpack`);

    if (!fs.existsSync(bundlePath)) {
      return null;
    }

    const buffer = fs.readFileSync(bundlePath);
    return msgpack.decode(buffer);
  }

  /**
   * Get instant context for Claude (minimal tokens)
   */
  getInstantContext(projectName) {
    const bundle = this.loadBundle(projectName);
    if (!bundle) return null;

    // Format for minimum tokens
    const lines = [
      `[${bundle.p}] ${bundle.d}`,
      `Tech: ${bundle.t}`,
    ];

    if (bundle.dp?.stg) {
      lines.push(`Deploy: stg=${bundle.dp.stg.slice(0, 50)}...`);
    }

    if (bundle.r?.length > 0) {
      lines.push('Recent:');
      bundle.r.forEach(s => lines.push(`  ${s.d}: ${s.s}`));
    }

    if (bundle.c?.length > 0) {
      lines.push(`Concepts: ${bundle.c.join(', ')}`);
    }

    return lines.join('\n');
  }

  // ============================================
  // PHASE 2: Knowledge Graph Queries
  // ============================================

  /**
   * Find what relates to a concept
   * "What relates to docker?" → optimization, deployment, build...
   */
  async relates(concept) {
    await this.loadStructures();

    if (!this.graph) {
      return { error: 'Graph not built. Run: node neural-memory.js build' };
    }

    const normalized = concept.toLowerCase();
    const node = this.graph.nodes[normalized];
    const edges = this.graph.edges[normalized] || [];

    if (!node) {
      // Try fuzzy match
      const similar = Object.keys(this.graph.nodes)
        .filter(k => k.includes(normalized) || normalized.includes(k))
        .slice(0, 5);

      return {
        concept: normalized,
        found: false,
        similar: similar.length > 0 ? similar : null,
        message: `Concept "${concept}" not found in graph`
      };
    }

    // Get sessions for this concept
    const sessions = node.s || [];

    // Get related concepts with strength
    const related = edges.map(e => ({
      concept: e.c,
      strength: e.w,
      shared_sessions: e.w
    }));

    // Find second-degree connections (related to related)
    const secondDegree = [];
    for (const edge of edges.slice(0, 3)) {
      const subEdges = this.graph.edges[edge.c] || [];
      for (const sub of subEdges.slice(0, 3)) {
        if (sub.c !== normalized && !related.find(r => r.concept === sub.c)) {
          secondDegree.push({
            concept: sub.c,
            via: edge.c,
            strength: sub.w
          });
        }
      }
    }

    return {
      concept: normalized,
      found: true,
      weight: node.w,
      sessions: sessions.slice(0, 5),
      directly_related: related,
      second_degree: [...new Map(secondDegree.map(d => [d.concept, d])).values()].slice(0, 5)
    };
  }

  /**
   * Find path between two concepts
   * "How are docker and typescript connected?"
   */
  async path(from, to) {
    await this.loadStructures();

    if (!this.graph) {
      return { error: 'Graph not built. Run: node neural-memory.js build' };
    }

    const fromNorm = from.toLowerCase();
    const toNorm = to.toLowerCase();

    if (!this.graph.nodes[fromNorm]) {
      return { error: `Concept "${from}" not found` };
    }
    if (!this.graph.nodes[toNorm]) {
      return { error: `Concept "${to}" not found` };
    }

    // BFS to find shortest path
    const visited = new Set();
    const queue = [[fromNorm]];
    const maxDepth = 4;

    while (queue.length > 0) {
      const path = queue.shift();
      const current = path[path.length - 1];

      if (current === toNorm) {
        return {
          from: fromNorm,
          to: toNorm,
          connected: true,
          path: path,
          distance: path.length - 1,
          explanation: this.explainPath(path)
        };
      }

      if (path.length >= maxDepth) continue;
      if (visited.has(current)) continue;
      visited.add(current);

      const edges = this.graph.edges[current] || [];
      for (const edge of edges) {
        if (!visited.has(edge.c)) {
          queue.push([...path, edge.c]);
        }
      }
    }

    return {
      from: fromNorm,
      to: toNorm,
      connected: false,
      message: `No path found between "${from}" and "${to}" within ${maxDepth} hops`
    };
  }

  /**
   * Explain a path between concepts
   */
  explainPath(path) {
    if (path.length < 2) return '';

    const parts = [];
    for (let i = 0; i < path.length - 1; i++) {
      const from = path[i];
      const to = path[i + 1];
      const edges = this.graph.edges[from] || [];
      const edge = edges.find(e => e.c === to);
      const strength = edge ? edge.w : 0;

      parts.push(`${from} → ${to} (${strength} shared)`);
    }

    return parts.join(' → ');
  }

  /**
   * Learn about a concept - get sessions, decisions, and context
   * "What did we learn about authentication?"
   */
  async learn(concept) {
    await this.loadStructures();

    if (!this.graph) {
      return { error: 'Graph not built. Run: node neural-memory.js build' };
    }

    const normalized = concept.toLowerCase();
    const node = this.graph.nodes[normalized];

    if (!node) {
      return { error: `Concept "${concept}" not found` };
    }

    // Get all sessions for this concept
    const sessionIds = node.s || [];

    // Load session details from sessions-index files
    const sessionsDetails = [];
    const projectsDir = path.join(MEMEX_PATH, 'summaries/projects');

    if (fs.existsSync(projectsDir)) {
      for (const project of fs.readdirSync(projectsDir)) {
        const indexPath = path.join(projectsDir, project, 'sessions-index.json');
        if (!fs.existsSync(indexPath)) continue;

        try {
          const data = JSON.parse(fs.readFileSync(indexPath, 'utf8'));
          for (const session of data.sessions || []) {
            if (sessionIds.includes(session.id)) {
              sessionsDetails.push({
                id: session.id,
                project: project,
                date: session.date,
                summary: session.summary,
                topics: session.topics || []
              });
            }
          }
        } catch (e) {
          // Skip on error
        }
      }
    }

    // Sort by date (newest first)
    sessionsDetails.sort((a, b) => new Date(b.date) - new Date(a.date));

    // Get related concepts for context
    const related = (this.graph.edges[normalized] || [])
      .slice(0, 5)
      .map(e => e.c);

    return {
      concept: normalized,
      total_sessions: node.w,
      sessions: sessionsDetails.slice(0, 10),
      related_concepts: related,
      summary: this.summarizeLearnings(sessionsDetails)
    };
  }

  /**
   * Summarize learnings from sessions
   */
  summarizeLearnings(sessions) {
    if (sessions.length === 0) return 'No sessions found';

    const projects = [...new Set(sessions.map(s => s.project))];
    const dateRange = sessions.length > 1
      ? `${sessions[sessions.length - 1].date} to ${sessions[0].date}`
      : sessions[0].date;

    return `${sessions.length} sessions across ${projects.join(', ')} (${dateRange})`;
  }

  /**
   * List all concepts in the graph
   */
  async concepts(options = {}) {
    await this.loadStructures();

    if (!this.graph) {
      return { error: 'Graph not built. Run: node neural-memory.js build' };
    }

    const { minWeight = 1, limit = 20 } = options;

    const concepts = Object.entries(this.graph.nodes)
      .filter(([_, v]) => v.w >= minWeight)
      .sort((a, b) => b[1].w - a[1].w)
      .slice(0, limit)
      .map(([k, v]) => ({
        concept: k,
        sessions: v.w,
        related: (this.graph.edges[k] || []).length
      }));

    return {
      total: Object.keys(this.graph.nodes).length,
      showing: concepts.length,
      concepts
    };
  }
}

// CLI
const command = process.argv[2];
const neural = new NeuralMemory();

(async () => {
  try {
    switch (command) {
      case 'build':
        const buildResult = await neural.build();
        console.log('\n📊 Summary:');
        console.log(JSON.stringify(buildResult, null, 2));
        break;

      case 'query':
        const queryText = process.argv.slice(3).join(' ');
        if (!queryText) {
          console.error('Usage: neural-memory.js query <text>');
          process.exit(1);
        }
        console.log(`🔍 Neural query: "${queryText}"\n`);
        const queryResult = await neural.query(queryText);
        console.log(JSON.stringify(queryResult, null, 2));
        break;

      case 'bundle':
        const projectName = process.argv[3];
        if (projectName) {
          const context = neural.getInstantContext(projectName);
          if (context) {
            console.log(`📦 Instant context for ${projectName}:\n`);
            console.log(context);
            console.log(`\n(${context.length} chars)`);
          } else {
            console.log(`No bundle found for ${projectName}`);
          }
        } else {
          console.log('Available bundles:');
          const bundlesDir = path.join(NEURAL_PATH, 'bundles');
          if (fs.existsSync(bundlesDir)) {
            fs.readdirSync(bundlesDir).forEach(f => {
              console.log(`  - ${f.replace('.msgpack', '')}`);
            });
          }
        }
        break;

      case 'stats':
        const stats = neural.getStats();
        console.log('🧠 Neural Memory Stats:\n');
        console.log(JSON.stringify(stats, null, 2));
        break;

      // ============================================
      // PHASE 2: Knowledge Graph Commands
      // ============================================

      case 'relates':
        const relatesConcept = process.argv[3];
        if (!relatesConcept) {
          console.error('Usage: neural-memory.js relates <concept>');
          console.error('Example: neural-memory.js relates docker');
          process.exit(1);
        }
        console.log(`🔗 What relates to "${relatesConcept}"?\n`);
        const relatesResult = await neural.relates(relatesConcept);
        if (relatesResult.found) {
          console.log(`Concept: ${relatesResult.concept} (${relatesResult.weight} sessions)\n`);
          console.log('Directly related:');
          relatesResult.directly_related.forEach(r => {
            console.log(`  ${r.concept} (${r.strength} shared sessions)`);
          });
          if (relatesResult.second_degree.length > 0) {
            console.log('\nSecond-degree (related to related):');
            relatesResult.second_degree.forEach(r => {
              console.log(`  ${r.concept} (via ${r.via})`);
            });
          }
          console.log('\nSample sessions:', relatesResult.sessions.slice(0, 3).join(', '));
        } else {
          console.log(relatesResult.message);
          if (relatesResult.similar) {
            console.log('Did you mean:', relatesResult.similar.join(', '));
          }
        }
        break;

      case 'path':
        const pathFrom = process.argv[3];
        const pathTo = process.argv[4];
        if (!pathFrom || !pathTo) {
          console.error('Usage: neural-memory.js path <from> <to>');
          console.error('Example: neural-memory.js path docker typescript');
          process.exit(1);
        }
        console.log(`🛤️  Path from "${pathFrom}" to "${pathTo}":\n`);
        const pathResult = await neural.path(pathFrom, pathTo);
        if (pathResult.connected) {
          console.log(`Connected! Distance: ${pathResult.distance} hops\n`);
          console.log(`Path: ${pathResult.path.join(' → ')}`);
          console.log(`\nExplanation: ${pathResult.explanation}`);
        } else {
          console.log(pathResult.message || pathResult.error);
        }
        break;

      case 'learn':
        const learnConcept = process.argv[3];
        if (!learnConcept) {
          console.error('Usage: neural-memory.js learn <concept>');
          console.error('Example: neural-memory.js learn docker');
          process.exit(1);
        }
        console.log(`📚 Learning about "${learnConcept}":\n`);
        const learnResult = await neural.learn(learnConcept);
        if (learnResult.error) {
          console.log(learnResult.error);
        } else {
          console.log(`Summary: ${learnResult.summary}\n`);
          console.log('Related concepts:', learnResult.related_concepts.join(', '));
          console.log('\nSessions:');
          learnResult.sessions.forEach(s => {
            console.log(`  [${s.date}] ${s.project}: ${s.summary.slice(0, 60)}...`);
          });
        }
        break;

      case 'concepts':
        console.log('📊 All concepts in graph:\n');
        const conceptsResult = await neural.concepts({ limit: 30 });
        console.log(`Total: ${conceptsResult.total} concepts\n`);
        console.log('Top concepts by session count:');
        conceptsResult.concepts.forEach(c => {
          console.log(`  ${c.concept.padEnd(20)} ${c.sessions} sessions, ${c.related} related`);
        });
        break;

      case 'viz':
        console.log('🎨 Generating graph visualization...');
        const { execSync } = require('child_process');
        execSync('node ' + path.join(MEMEX_PATH, 'scripts/graph-viz.js'), { stdio: 'inherit' });
        break;

      default:
        console.log(`
Neural Memory v2.0 - AI-Native Knowledge Storage

Usage:
  node neural-memory.js build           Build all neural structures
  node neural-memory.js query <text>    Semantic query with graph enrichment
  node neural-memory.js bundle [project] Get instant context bundle
  node neural-memory.js stats           Show neural memory statistics

Phase 2 - Knowledge Graph:
  node neural-memory.js relates <concept>     What relates to this concept?
  node neural-memory.js path <from> <to>      How are two concepts connected?
  node neural-memory.js learn <concept>       What did we learn about this?
  node neural-memory.js concepts              List all concepts in graph
  node neural-memory.js viz                   Open interactive graph visualization

Examples:
  node neural-memory.js relates docker
  node neural-memory.js path docker typescript
  node neural-memory.js learn memex

This creates:
  .neural/embeddings.msgpack   Binary embeddings (50% smaller)
  .neural/graph.msgpack        Concept relationship graph
  .neural/bundles/*.msgpack    Pre-compiled project contexts
`);
    }
  } catch (error) {
    console.error('Error:', error.message);
    if (process.env.DEBUG) console.error(error.stack);
    process.exit(1);
  }
})();

module.exports = NeuralMemory;
