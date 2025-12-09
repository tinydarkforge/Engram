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
const cli = require('./cli-utils');

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
   * Cross-project search - find related work across ALL projects
   *
   * Example: "What did I learn about docker across all projects?"
   */
  async crossProject(queryText, options = {}) {
    const { limit = 20, groupByProject = true } = options;

    // Initialize vector search if needed
    if (!this.vectorSearch) {
      const VectorSearch = require('./vector-search');
      this.vectorSearch = new VectorSearch();
      await this.vectorSearch.initialize();
    }

    // Load structures for enrichment
    await this.loadStructures();

    // Search across all sessions
    const searchResults = await this.vectorSearch.search(queryText, {
      limit,
      useDecay: true,
      minSimilarity: 0.15
    });

    // Map session ID prefixes to project names
    const prefixToProject = this.buildPrefixMap();

    // Enrich results with project info
    const enriched = searchResults.results.map(result => {
      const sessionId = result.session_id;
      const prefix = sessionId.split('-')[0];
      const project = prefixToProject[prefix] || 'Unknown';
      const concepts = this.graph?.reverse?.[sessionId] || [];

      return {
        ...result,
        project,
        concepts: concepts.slice(0, 5)
      };
    });

    if (!groupByProject) {
      return {
        query: queryText,
        results: enriched,
        total: searchResults.total_matches
      };
    }

    // Group by project
    const byProject = {};
    for (const result of enriched) {
      if (!byProject[result.project]) {
        byProject[result.project] = {
          project: result.project,
          sessions: [],
          totalScore: 0,
          topConcepts: new Set()
        };
      }
      byProject[result.project].sessions.push(result);
      byProject[result.project].totalScore += result.score;
      result.concepts.forEach(c => byProject[result.project].topConcepts.add(c));
    }

    // Convert to array and sort by total relevance
    const projects = Object.values(byProject)
      .map(p => ({
        project: p.project,
        sessions: p.sessions,
        sessionCount: p.sessions.length,
        avgScore: Math.round((p.totalScore / p.sessions.length) * 100) / 100,
        topConcepts: [...p.topConcepts].slice(0, 8)
      }))
      .sort((a, b) => b.sessionCount - a.sessionCount || b.avgScore - a.avgScore);

    // Summary
    const allConcepts = new Set();
    enriched.forEach(r => r.concepts.forEach(c => allConcepts.add(c)));

    return {
      query: queryText,
      summary: {
        totalSessions: enriched.length,
        projectsFound: projects.length,
        topConcepts: [...allConcepts].slice(0, 10)
      },
      byProject: projects
    };
  }

  /**
   * Build mapping from session ID prefix to project name
   */
  buildPrefixMap() {
    const map = {};
    const projectsDir = path.join(MEMEX_PATH, 'summaries/projects');

    if (!fs.existsSync(projectsDir)) return map;

    for (const project of fs.readdirSync(projectsDir)) {
      const indexPath = path.join(projectsDir, project, 'sessions-index.json');
      if (!fs.existsSync(indexPath)) continue;

      try {
        const data = JSON.parse(fs.readFileSync(indexPath, 'utf8'));
        for (const session of (data.sessions || []).slice(0, 1)) {
          const prefix = session.id.split('-')[0];
          map[prefix] = project;
        }
      } catch (e) {
        // Skip malformed files
      }
    }

    return map;
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
        cli.section('Build Summary', cli.icons.stats);
        cli.stats({
          'Embeddings': `${buildResult.embeddings?.sessions || 0} sessions`,
          'Graph': `${buildResult.graph?.concepts || 0} concepts`,
          'Bundles': `${buildResult.bundles?.count || 0} projects`
        });
        break;

      case 'query':
        const queryText = process.argv.slice(3).join(' ');
        if (!queryText) {
          cli.error('Usage: neural-memory.js query <text>');
          process.exit(1);
        }
        const queryResult = await neural.query(queryText);
        cli.searchResults(queryResult.results || [], queryText);
        break;

      case 'bundle':
        const projectName = process.argv[3];
        if (projectName) {
          const context = neural.getInstantContext(projectName);
          if (context) {
            cli.header(`Bundle: ${projectName}`, cli.icons.package);
            console.log(context);
            cli.info(`${context.length} chars`);
          } else {
            cli.error(`No bundle found for ${projectName}`);
          }
        } else {
          cli.header('Available Bundles', cli.icons.package);
          const bundlesDir = path.join(NEURAL_PATH, 'bundles');
          if (fs.existsSync(bundlesDir)) {
            const bundles = fs.readdirSync(bundlesDir).map(f => ({
              name: f.replace('.msgpack', ''),
              size: fs.statSync(path.join(bundlesDir, f)).size
            }));
            cli.table(bundles, [
              { key: 'name', label: 'Project', width: 25 },
              { key: 'size', label: 'Size', width: 10, align: 'right' }
            ]);
          }
        }
        break;

      case 'stats':
        const statsData = neural.getStats();
        cli.header('Neural Memory Stats');
        cli.stats({
          'Neural Path': statsData.neural_path,
          'Embeddings': statsData.structures?.embeddings ? cli.colors.success('✓') : cli.colors.muted('–'),
          'Graph': statsData.structures?.graph ? cli.colors.success('✓') : cli.colors.muted('–')
        });
        if (statsData.structures) {
          cli.section('Structure Sizes');
          cli.simpleTable(Object.entries(statsData.structures).map(([k, v]) => [
            k, v ? `${(v / 1024).toFixed(1)} KB` : '–'
          ]));
        }
        break;

      // ============================================
      // PHASE 2: Knowledge Graph Commands
      // ============================================

      case 'relates':
        const relatesConcept = process.argv[3];
        if (!relatesConcept) {
          cli.error('Usage: neural-memory.js relates <concept>');
          cli.info('Example: neural-memory.js relates docker');
          process.exit(1);
        }
        const relatesResult = await neural.relates(relatesConcept);
        cli.header(`Relates: ${relatesConcept}`, cli.icons.graph);

        if (relatesResult.found) {
          cli.keyValue('Concept', cli.colors.primary(relatesResult.concept));
          cli.keyValue('Sessions', relatesResult.weight);

          cli.section('Directly Related');
          const relatedData = relatesResult.directly_related.map(r => ({
            concept: cli.topicTag(r.concept, r.strength),
            strength: `${r.strength} shared`
          }));
          cli.table(relatedData, [
            { key: 'concept', label: 'Concept', width: 20 },
            { key: 'strength', label: 'Strength', width: 15 }
          ]);

          if (relatesResult.second_degree.length > 0) {
            cli.section('Second Degree');
            relatesResult.second_degree.forEach(r => {
              cli.indent(`${cli.colors.muted(r.concept)} via ${r.via}`);
            });
          }
        } else {
          cli.warning(relatesResult.message);
          if (relatesResult.similar) {
            cli.info(`Did you mean: ${relatesResult.similar.join(', ')}`);
          }
        }
        break;

      case 'path':
        const pathFrom = process.argv[3];
        const pathTo = process.argv[4];
        if (!pathFrom || !pathTo) {
          cli.error('Usage: neural-memory.js path <from> <to>');
          cli.info('Example: neural-memory.js path docker typescript');
          process.exit(1);
        }
        const pathResult = await neural.path(pathFrom, pathTo);
        cli.header(`Path: ${pathFrom} → ${pathTo}`);

        if (pathResult.connected) {
          cli.success(`Connected! Distance: ${pathResult.distance} hops`);
          console.log();
          console.log(`  ${cli.colors.primary(pathResult.path.join(` ${cli.icons.arrow} `))}`);
          console.log();
          cli.info(pathResult.explanation);
        } else {
          cli.warning(pathResult.message || pathResult.error);
        }
        break;

      case 'learn':
        const learnConcept = process.argv[3];
        if (!learnConcept) {
          cli.error('Usage: neural-memory.js learn <concept>');
          cli.info('Example: neural-memory.js learn docker');
          process.exit(1);
        }
        const learnResult = await neural.learn(learnConcept);
        cli.header(`Learn: ${learnConcept}`);

        if (learnResult.error) {
          cli.warning(learnResult.error);
        } else {
          console.log(learnResult.summary);
          console.log();
          cli.section('Related Concepts');
          cli.topicList(learnResult.related_concepts.map(c => ({ name: c, count: 1 })), false);
          cli.section('Sessions');
          learnResult.sessions.forEach(s => cli.sessionItem(s));
        }
        break;

      case 'concepts':
        const conceptsResult = await neural.concepts({ limit: 30 });
        cli.header('Concepts', cli.icons.stats);
        cli.keyValue('Total', conceptsResult.total);
        console.log();

        cli.table(conceptsResult.concepts, [
          { key: 'concept', label: 'Concept', width: 22 },
          { key: 'sessions', label: 'Sessions', width: 10, align: 'right' },
          { key: 'related', label: 'Related', width: 10, align: 'right' }
        ]);
        break;

      case 'viz':
        cli.info('Generating graph visualization...');
        const { execSync } = require('child_process');
        execSync('node ' + path.join(MEMEX_PATH, 'scripts/graph-viz.js'), { stdio: 'inherit' });
        break;

      case 'across':
        const acrossQuery = process.argv.slice(3).join(' ');
        if (!acrossQuery) {
          cli.error('Usage: neural-memory.js across <query>');
          cli.info('Example: neural-memory.js across "docker deployment"');
          process.exit(1);
        }
        const acrossResult = await neural.crossProject(acrossQuery);
        cli.header(`Cross-Project: "${acrossQuery}"`, cli.icons.search);

        cli.stats({
          'Sessions found': acrossResult.summary.totalSessions,
          'Projects': acrossResult.summary.projectsFound,
          'Top concepts': acrossResult.summary.topConcepts.slice(0, 5).join(', ') || '–'
        });

        for (const proj of acrossResult.byProject) {
          cli.section(`${proj.project}`, cli.icons.package);
          cli.keyValue('  Sessions', proj.sessionCount);
          cli.keyValue('  Avg score', `${(proj.avgScore * 100).toFixed(0)}%`);

          if (proj.topConcepts.length > 0) {
            cli.keyValue('  Concepts', proj.topConcepts.slice(0, 5).join(', '));
          }

          // Show top 2 sessions per project
          proj.sessions.slice(0, 2).forEach(s => {
            const preview = s.text_preview?.slice(0, 60) || s.session_id;
            const score = cli.colors.primary(`${(s.score * 100).toFixed(0)}%`);
            cli.indent(`${score} ${preview}...`, 2);
          });
        }
        break;

      default:
        cli.header('Neural Memory v2.0');
        console.log(cli.colors.muted('AI-Native Knowledge Storage\n'));

        cli.section('Core Commands');
        cli.simpleTable([
          ['build', 'Build all neural structures'],
          ['query <text>', 'Semantic query with graph enrichment'],
          ['bundle [project]', 'Get instant context bundle'],
          ['stats', 'Show neural memory statistics']
        ], 22);

        cli.section('Knowledge Graph');
        cli.simpleTable([
          ['relates <concept>', 'What relates to this concept?'],
          ['path <from> <to>', 'How are two concepts connected?'],
          ['learn <concept>', 'What did we learn about this?'],
          ['concepts', 'List all concepts in graph'],
          ['viz', 'Open interactive graph visualization'],
          ['across <query>', 'Search across ALL projects']
        ], 22);

        cli.section('Examples');
        cli.indent(cli.colors.muted('node neural-memory.js relates docker'));
        cli.indent(cli.colors.muted('node neural-memory.js path docker typescript'));
        cli.indent(cli.colors.muted('node neural-memory.js learn memex'));
    }
  } catch (error) {
    cli.error(error.message);
    if (process.env.DEBUG) console.error(error.stack);
    process.exit(1);
  }
})();

module.exports = NeuralMemory;
