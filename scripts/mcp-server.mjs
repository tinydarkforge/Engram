#!/usr/bin/env node

/**
 * Memex MCP Server
 *
 * Exposes Neural Memory as tools for AI assistant via Model Context Protocol.
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
 * Configure in AI assistant Code settings:
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

import { fileURLToPath } from 'url';
import { createRequire } from 'module';

const __filename = fileURLToPath(import.meta.url);
const __dirname = import.meta.dirname || fileURLToPath(new URL('.', import.meta.url));
const require = createRequire(import.meta.url);

const {
  loadIndex,
  loadGraph,
  neuralSearch,
  getBundle,
  listProjects,
  recentSessions,
  searchSessions,
  getSession,
  getTopics,
  queryConcept,
  crossProjectSearch,
  remember,
  getStats,
  getGraphSummary,
} = require('./mcp-tools.js');

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
        name: 'remember',
        description: 'Save a memory or session to Memex. Call at end of session, after completing a feature, or when recording a decision.',
        inputSchema: {
          type: 'object',
          properties: {
            summary: {
              type: 'string',
              description: '1-3 sentence summary of what was done or learned.',
              maxLength: 1000
            },
            topics: {
              type: 'array',
              items: { type: 'string' },
              description: '2-8 topic tags, e.g. [\'auth\', \'jwt\', \'security\']',
              maxItems: 20
            },
            project: {
              type: 'string',
              description: 'Project name. Required when called via MCP (no cwd context available).'
            },
            key_decisions: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  decision: { type: 'string' },
                  rationale: { type: 'string' }
                }
              }
            },
            learnings: {
              type: 'array',
              items: { type: 'string' }
            }
          },
          required: ['summary', 'topics', 'project']
        }
      },
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
              description: 'Project name (e.g., "Memex", "DemoProject", "DevOps")'
            }
          },
          required: ['project']
        }
      },
      {
        name: 'get_session',
        description: 'Get full session details by project and session ID.',
        inputSchema: {
          type: 'object',
          properties: {
            project: {
              type: 'string',
              description: 'Project name (e.g., "Memex", "DemoProject", "DevOps")'
            },
            session_id: {
              type: 'string',
              description: 'Session ID to retrieve'
            }
          },
          required: ['project', 'session_id']
        }
      },
      {
        name: 'search_sessions',
        description: 'Keyword search across sessions by summary and topics.',
        inputSchema: {
          type: 'object',
          properties: {
            query: {
              type: 'string',
              description: 'Keyword query to search for'
            },
            project: {
              type: 'string',
              description: 'Optional project name to scope results'
            },
            limit: {
              type: 'number',
              description: 'Maximum results to return (default: 10)',
              default: 10
            }
          },
          required: ['query']
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
    case 'remember':
      result = await remember(args);
      break;

    case 'neural_search':
      result = await neuralSearch(args.query, args.limit || 10, args.use_decay !== false);
      break;

    case 'get_bundle':
      result = getBundle(args.project);
      break;

    case 'get_session':
      result = getSession(args.project, args.session_id);
      break;

    case 'search_sessions':
      result = searchSessions(args.query, args.project, args.limit || 10);
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
    const stats = getStats();
    return {
      contents: [{ uri, mimeType: 'application/json', text: JSON.stringify(stats, null, 2) }]
    };
  }

  if (uri === 'memex://graph') {
    const summary = getGraphSummary();
    return {
      contents: [{ uri, mimeType: 'application/json', text: JSON.stringify(summary, null, 2) }]
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
