#!/usr/bin/env node

/**
 * Memex MCP Server
 *
 * Exposes Neural Memory as tools for Claude via Model Context Protocol.
 *
 * Tools:
 *   - neural_search: Semantic search across all sessions
 *   - get_bundle: Get compiled project context
 *   - list_projects: Show all indexed projects
 *   - recent_sessions: Get recent sessions across projects
 *   - remember: Save a new session (requires confirmation)
 *
 * Usage:
 *   node mcp-server.js              # Start MCP server (stdio)
 *
 * Configure in Claude Code settings:
 *   "mcpServers": {
 *     "memex": {
 *       "command": "node",
 *       "args": ["/path/to/Memex/scripts/mcp-server.js"]
 *     }
 *   }
 */

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  ListResourcesRequestSchema,
  ReadResourceRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { createRequire } from 'module';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const require = createRequire(import.meta.url);

const MEMEX_PATH = process.env.MEMEX_PATH || path.join(process.env.HOME, 'code/cirrus/DevOps/Memex');

// ─────────────────────────────────────────────────────────────
// Helper Functions
// ─────────────────────────────────────────────────────────────

function loadIndex() {
  const indexPath = path.join(MEMEX_PATH, 'index.json');
  return JSON.parse(fs.readFileSync(indexPath, 'utf8'));
}

function loadSessionsIndex(project) {
  const indexPath = path.join(MEMEX_PATH, 'summaries/projects', project, 'sessions-index.json');
  if (!fs.existsSync(indexPath)) return null;
  return JSON.parse(fs.readFileSync(indexPath, 'utf8'));
}

function loadGraph() {
  const msgpack = require('msgpack-lite');
  const graphPath = path.join(MEMEX_PATH, '.neural/graph.msgpack');
  if (!fs.existsSync(graphPath)) return null;
  return msgpack.decode(fs.readFileSync(graphPath));
}

function loadBundle(projectName) {
  const msgpack = require('msgpack-lite');
  const bundlePath = path.join(MEMEX_PATH, '.neural/bundles', `${projectName}.msgpack`);
  if (!fs.existsSync(bundlePath)) return null;
  return msgpack.decode(fs.readFileSync(bundlePath));
}

// ─────────────────────────────────────────────────────────────
// Tool Implementations
// ─────────────────────────────────────────────────────────────

async function neuralSearch(query, limit = 10, useDecay = true) {
  try {
    const VectorSearch = require('./vector-search.js');
    const vs = new VectorSearch();
    await vs.initialize();

    const results = await vs.search(query, {
      limit,
      useDecay,
      minSimilarity: 0.15
    });

    // Enrich results with project info
    const enriched = results.results.map(r => {
      const parts = r.session_id.split('-');
      const projectPrefix = parts[0];
      return {
        ...r,
        project_hint: projectPrefix
      };
    });

    return {
      query,
      total: results.total_matches,
      decay_enabled: useDecay,
      results: enriched
    };
  } catch (e) {
    return { error: e.message };
  }
}

function getBundle(projectName) {
  const bundle = loadBundle(projectName);
  if (!bundle) {
    return { error: `Bundle not found for project: ${projectName}` };
  }

  return {
    project: projectName,
    description: bundle.d || '',
    tech: bundle.t || '',
    deployment: bundle.dp || '',
    environment: bundle.e || '',
    recent_sessions: bundle.r || [],
    concepts: bundle.c || []
  };
}

function listProjects() {
  const index = loadIndex();
  const projects = Object.entries(index.p || {}).map(([name, data]) => ({
    name,
    sessions: data.sc || 0,
    last_updated: data.u || 'unknown',
    description: data.d || ''
  }));

  return {
    total: projects.length,
    projects: projects.sort((a, b) => b.sessions - a.sessions)
  };
}

function recentSessions(limit = 10) {
  const projectsDir = path.join(MEMEX_PATH, 'summaries/projects');
  const allSessions = [];

  for (const proj of fs.readdirSync(projectsDir)) {
    const data = loadSessionsIndex(proj);
    if (!data?.sessions) continue;

    for (const s of data.sessions.slice(0, 20)) {
      allSessions.push({
        project: proj,
        id: s.id,
        date: s.date,
        summary: s.summary,
        topics: s.topics || []
      });
    }
  }

  // Sort by date descending
  allSessions.sort((a, b) => new Date(b.date) - new Date(a.date));

  return {
    total: allSessions.length,
    sessions: allSessions.slice(0, limit)
  };
}

function getTopics(limit = 30) {
  const index = loadIndex();
  const topics = Object.entries(index.t || {})
    .filter(([name]) => name)
    .map(([name, data]) => ({
      name,
      sessions: data.sc || 0,
      projects: data.p || []
    }))
    .sort((a, b) => b.sessions - a.sessions)
    .slice(0, limit);

  return { total: Object.keys(index.t || {}).length, topics };
}

function queryConcept(concept) {
  const graph = loadGraph();
  if (!graph) return { error: 'Graph not built. Run: node neural-memory.js build' };

  const normalized = concept.toLowerCase().trim();
  const node = graph.nodes?.[normalized];

  if (!node) {
    return { found: false, concept: normalized, suggestion: 'Try a different term' };
  }

  // Get related concepts
  const related = (graph.edges?.[normalized] || [])
    .map(r => ({ concept: r.c, strength: r.w }))
    .sort((a, b) => b.strength - a.strength)
    .slice(0, 10);

  return {
    found: true,
    concept: normalized,
    sessions_count: node.w,
    related_concepts: related
  };
}

async function crossProjectSearch(query, limit = 20) {
  try {
    const NeuralMemory = require('./neural-memory.js');
    const neural = new NeuralMemory();
    const result = await neural.crossProject(query, { limit, groupByProject: true });
    return result;
  } catch (e) {
    return { error: e.message };
  }
}

// ─────────────────────────────────────────────────────────────
// MCP Server Setup
// ─────────────────────────────────────────────────────────────

const server = new Server(
  {
    name: 'memex',
    version: '1.0.0',
  },
  {
    capabilities: {
      tools: {},
      resources: {},
    },
  }
);

// List available tools
server.setRequestHandler(ListToolsRequestSchema, async () => {
  return {
    tools: [
      {
        name: 'neural_search',
        description: 'Semantic search across all Neural Memory sessions. Finds sessions by meaning, not just keywords. Use this to find relevant past work, learnings, and context.',
        inputSchema: {
          type: 'object',
          properties: {
            query: {
              type: 'string',
              description: 'The search query (searches by semantic meaning)'
            },
            limit: {
              type: 'number',
              description: 'Maximum results to return (default: 10)',
              default: 10
            },
            use_decay: {
              type: 'boolean',
              description: 'Apply time decay so recent sessions rank higher (default: true)',
              default: true
            }
          },
          required: ['query']
        }
      },
      {
        name: 'get_bundle',
        description: 'Get pre-compiled context bundle for a specific project. Includes description, tech stack, recent sessions, and key concepts.',
        inputSchema: {
          type: 'object',
          properties: {
            project: {
              type: 'string',
              description: 'Project name (e.g., "Memex", "CirrusTranslate", "DevOps")'
            }
          },
          required: ['project']
        }
      },
      {
        name: 'list_projects',
        description: 'List all projects indexed in Neural Memory with session counts.',
        inputSchema: {
          type: 'object',
          properties: {}
        }
      },
      {
        name: 'recent_sessions',
        description: 'Get the most recent sessions across all projects.',
        inputSchema: {
          type: 'object',
          properties: {
            limit: {
              type: 'number',
              description: 'Maximum sessions to return (default: 10)',
              default: 10
            }
          }
        }
      },
      {
        name: 'get_topics',
        description: 'Get top topics/tags from Neural Memory with session counts.',
        inputSchema: {
          type: 'object',
          properties: {
            limit: {
              type: 'number',
              description: 'Maximum topics to return (default: 30)',
              default: 30
            }
          }
        }
      },
      {
        name: 'query_concept',
        description: 'Look up a concept in the knowledge graph. Returns related concepts and connection strengths.',
        inputSchema: {
          type: 'object',
          properties: {
            concept: {
              type: 'string',
              description: 'The concept to look up (e.g., "docker", "authentication")'
            }
          },
          required: ['concept']
        }
      },
      {
        name: 'cross_project_search',
        description: 'Search across ALL projects semantically. Groups results by project with relevance scores. Great for finding related work across the entire codebase.',
        inputSchema: {
          type: 'object',
          properties: {
            query: {
              type: 'string',
              description: 'The search query (searches by semantic meaning across all projects)'
            },
            limit: {
              type: 'number',
              description: 'Maximum total results across all projects (default: 20)',
              default: 20
            }
          },
          required: ['query']
        }
      }
    ]
  };
});

// Handle tool calls
server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;

  let result;

  switch (name) {
    case 'neural_search':
      result = await neuralSearch(args.query, args.limit || 10, args.use_decay !== false);
      break;

    case 'get_bundle':
      result = getBundle(args.project);
      break;

    case 'list_projects':
      result = listProjects();
      break;

    case 'recent_sessions':
      result = recentSessions(args.limit || 10);
      break;

    case 'get_topics':
      result = getTopics(args.limit || 30);
      break;

    case 'query_concept':
      result = queryConcept(args.concept);
      break;

    case 'cross_project_search':
      result = await crossProjectSearch(args.query, args.limit || 20);
      break;

    default:
      result = { error: `Unknown tool: ${name}` };
  }

  return {
    content: [
      {
        type: 'text',
        text: JSON.stringify(result, null, 2)
      }
    ]
  };
});

// List available resources
server.setRequestHandler(ListResourcesRequestSchema, async () => {
  return {
    resources: [
      {
        uri: 'memex://stats',
        name: 'Neural Memory Stats',
        description: 'Overview statistics of the Neural Memory system',
        mimeType: 'application/json'
      },
      {
        uri: 'memex://graph',
        name: 'Concept Graph',
        description: 'The full concept relationship graph',
        mimeType: 'application/json'
      }
    ]
  };
});

// Handle resource reads
server.setRequestHandler(ReadResourceRequestSchema, async (request) => {
  const { uri } = request.params;

  if (uri === 'memex://stats') {
    const index = loadIndex();
    const stats = {
      version: index.v,
      last_updated: index.u,
      total_sessions: index.m?.ts || 0,
      total_topics: Object.keys(index.t || {}).length,
      projects: Object.keys(index.p || {}).length
    };

    return {
      contents: [
        {
          uri,
          mimeType: 'application/json',
          text: JSON.stringify(stats, null, 2)
        }
      ]
    };
  }

  if (uri === 'memex://graph') {
    const graph = loadGraph();
    if (!graph) {
      return {
        contents: [
          {
            uri,
            mimeType: 'application/json',
            text: JSON.stringify({ error: 'Graph not built' })
          }
        ]
      };
    }

    // Return summary, not full graph (too large)
    const summary = {
      concepts: Object.keys(graph.nodes || {}).length,
      connections: Object.values(graph.edges || {}).reduce((sum, arr) => sum + arr.length, 0),
      top_concepts: Object.entries(graph.nodes || {})
        .sort((a, b) => b[1].w - a[1].w)
        .slice(0, 20)
        .map(([name, data]) => ({ name, sessions: data.w }))
    };

    return {
      contents: [
        {
          uri,
          mimeType: 'application/json',
          text: JSON.stringify(summary, null, 2)
        }
      ]
    };
  }

  throw new Error(`Unknown resource: ${uri}`);
});

// ─────────────────────────────────────────────────────────────
// Start Server
// ─────────────────────────────────────────────────────────────

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error('Memex MCP Server started');
}

main().catch((error) => {
  console.error('Fatal error:', error);
  process.exit(1);
});
