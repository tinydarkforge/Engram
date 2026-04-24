#!/usr/bin/env node

/**
 * Codicil MCP Server
 *
 * Exposes Codicil memory and assertion ledger as tools via Model Context Protocol.
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
 *     "codicil": {
 *       "command": "node",
 *       "args": ["/path/to/Codicil/scripts/mcp-server.js"]
 *     }
 *   }
 */

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  ListPromptsRequestSchema,
  GetPromptRequestSchema,
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
  rebuildIndex,
  getStats,
  getGraphSummary,
  ledgerIngest,
  ledgerQuery,
  ledgerSelectContext,
  ledgerStats,
  findDuplicates,
} = require('./mcp-tools.js');
const { listPrompts, renderPrompt } = require('./mcp-prompts.js');

// ─────────────────────────────────────────────────────────────
// MCP Server Setup
// ─────────────────────────────────────────────────────────────

const server = new Server(
  {
    name: 'codicil',
    version: '1.0.0',
  },
  {
    capabilities: {
      tools: {},
      resources: {},
      prompts: {},
    },
  }
);

// List available tools
server.setRequestHandler(ListToolsRequestSchema, async () => {
  return {
    tools: [
      {
        name: 'remember',
        description: 'Save a memory or session to Codicil. Call at end of session, after completing a feature, or when recording a decision.',
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
        description: 'Semantic search across all Codicil sessions. Finds sessions by meaning, not just keywords. Use this to find relevant past work, learnings, and context.',
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
              description: 'Project name (e.g., "Codicil", "ProjectA", "ProjectB")'
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
              description: 'Project name (e.g., "Codicil", "ProjectA", "ProjectB")'
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
        description: 'List all projects indexed in Codicil with session counts.',
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
        description: 'Get top topics/tags from Codicil with session counts.',
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
      },
      {
        name: 'rebuild_index',
        description: 'Rebuild Codicil indexes (bloom, git, embeddings).',
        inputSchema: {
          type: 'object',
          properties: {
            bloom: {
              type: 'boolean',
              description: 'Rebuild Bloom filter (default: true)',
              default: true
            },
            git: {
              type: 'boolean',
              description: 'Rebuild git index (default: false)',
              default: false
            },
            embeddings: {
              type: 'boolean',
              description: 'Regenerate embeddings (default: false)',
              default: false
            }
          }
        }
      },
      {
        name: 'find_duplicates',
        description: 'Find duplicate or near-duplicate sessions using embedding similarity. Returns pairs of sessions above the similarity threshold.',
        inputSchema: {
          type: 'object',
          properties: {
            threshold: {
              type: 'number',
              description: 'Similarity threshold 0–1 (default: 0.85). Lower = more results.',
              default: 0.85
            },
            limit: {
              type: 'number',
              description: 'Max duplicate pairs to return (default: 20)',
              default: 20
            }
          }
        }
      },
      {
        name: 'ledger_ingest',
        description: 'Write an assertion to the ledger. Creates new or reinforces existing assertions.',
        inputSchema: {
          type: 'object',
          properties: {
            plane: {
              type: 'string',
              description: 'Plane identifier (e.g., user:alice, project:Codicil, session:id123)'
            },
            class_: {
              type: 'string',
              description: 'Assertion class: monotonic, episodic, state_bound, contextual',
              enum: ['monotonic', 'episodic', 'state_bound', 'contextual']
            },
            claim: {
              type: 'string',
              description: 'The assertion claim (max 500 chars)'
            },
            body: {
              type: 'string',
              description: 'Optional extended text'
            },
            confidence: {
              type: 'number',
              description: 'Confidence 0–1 (default 0.5)'
            },
            source_spans: {
              type: 'array',
              items: { type: 'string' },
              description: 'Source references (required, non-empty)'
            },
            density_hint: {
              type: 'string',
              description: 'Rendering hint: terse, standard, verbose',
              enum: ['terse', 'standard', 'verbose']
            },
            staleness_model: {
              type: 'string',
              description: 'Staleness model for decay'
            }
          },
          required: ['plane', 'class_', 'claim', 'source_spans']
        }
      },
      {
        name: 'ledger_query',
        description: 'Query active assertions by plane. Returns all non-fossilized/quarantined assertions.',
        inputSchema: {
          type: 'object',
          properties: {
            plane: {
              type: 'string',
              description: 'Plane identifier (e.g., user:alice, project:Codicil)'
            }
          },
          required: ['plane']
        }
      },
      {
        name: 'ledger_select_context',
        description: 'Select and render ranked assertions for context injection. Respects character budget.',
        inputSchema: {
          type: 'object',
          properties: {
            plane: {
              type: 'string',
              description: 'Plane identifier'
            },
            budget: {
              type: 'number',
              description: 'Maximum characters to use'
            },
            header: {
              type: 'string',
              description: 'Optional markdown header for the rendered block'
            }
          },
          required: ['plane', 'budget']
        }
      },
      {
        name: 'ledger_stats',
        description: 'Get ledger statistics: counts by status, plane, and tensions.',
        inputSchema: {
          type: 'object',
          properties: {}
        }
      }
    ]
  };
});

// List available prompts
server.setRequestHandler(ListPromptsRequestSchema, async () => {
  return {
    prompts: listPrompts()
  };
});

// Get prompt by name
server.setRequestHandler(GetPromptRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;
  return renderPrompt(name, args || {});
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

    case 'rebuild_index':
      result = rebuildIndex(args || {});
      break;

    case 'find_duplicates':
      result = await findDuplicates({ threshold: args?.threshold, limit: args?.limit });
      break;

    case 'ledger_ingest':
      result = ledgerIngest(args || {});
      break;

    case 'ledger_query':
      result = ledgerQuery(args.plane, args || {});
      break;

    case 'ledger_select_context':
      result = ledgerSelectContext(args.plane, args.budget || 2000, args || {});
      break;

    case 'ledger_stats':
      result = ledgerStats();
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
        uri: 'codicil://stats',
        name: 'Codicil Stats',
        description: 'Overview statistics of the Codicil memory and ledger',
        mimeType: 'application/json'
      },
      {
        uri: 'codicil://graph',
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

  if (uri === 'codicil://stats') {
    const stats = getStats();
    return {
      contents: [{ uri, mimeType: 'application/json', text: JSON.stringify(stats, null, 2) }]
    };
  }

  if (uri === 'codicil://graph') {
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
  console.error('Codicil MCP Server started');
}

main().catch((error) => {
  console.error('Fatal error:', error);
  process.exit(1);
});
