#!/usr/bin/env node

/**
 * Engram MCP Server
 *
 * Exposes Engram memory and assertion ledger as tools via Model Context Protocol.
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
 *     "engram": {
 *       "command": "node",
 *       "args": ["/path/to/Engram/scripts/mcp-server.js"]
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
  ListResourceTemplatesRequestSchema,
  SubscribeRequestSchema,
  UnsubscribeRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';

import { createRequire } from 'module';

const require = createRequire(import.meta.url);

const {
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
  handoff,
  receiveHandoff,
  sessionReplay,
  sessionDiff,
  sessionAppendEvent,
} = require('./mcp-tools.js');
const { listPrompts, renderPrompt } = require('./mcp-prompts.js');

// ─────────────────────────────────────────────────────────────
// MCP Server Setup
// ─────────────────────────────────────────────────────────────

const server = new Server(
  {
    name: 'engram',
    version: '1.0.0',
  },
  {
    capabilities: {
      tools: {},
      resources: {
        subscribe: true,
      },
      prompts: {},
    },
  }
);

const resourceSubscriptions = new Set();

// List available tools
server.setRequestHandler(ListToolsRequestSchema, async () => {
  return {
    tools: [
      {
        name: 'remember',
        description: 'Save a memory or session to Engram. Call at end of session, after completing a feature, or when recording a decision.',
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
            },
            events: {
              type: 'array',
              description: 'Optional timeline events for this session. Each event: { type, description, tokens_spent? }',
              items: {
                type: 'object',
                properties: {
                  type: { type: 'string', enum: ['decision', 'rejection', 'experiment', 'result', 'info'] },
                  description: { type: 'string' },
                  tokens_spent: { type: 'number' }
                },
                required: ['type', 'description']
              }
            }
          },
          required: ['summary', 'topics', 'project']
        }
      },
      {
        name: 'neural_search',
        description: 'Semantic search across all Engram sessions. Finds sessions by meaning, not just keywords. Use this to find relevant past work, learnings, and context.',
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
              description: 'Project name (e.g., "Engram", "ProjectA", "ProjectB")'
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
              description: 'Project name (e.g., "Engram", "ProjectA", "ProjectB")'
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
        description: 'List all projects indexed in Engram with session counts.',
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
        description: 'Get top topics/tags from Engram with session counts.',
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
        description: 'Rebuild Engram indexes (bloom, git, embeddings).',
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
              description: 'Plane identifier (e.g., user:alice, project:Engram, session:id123)'
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
              description: 'Plane identifier (e.g., user:alice, project:Engram)'
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
      },
      {
        name: 'handoff',
        description: 'Generate a portable context blob for agent-to-agent handoff. Packs project bundle, recent sessions, ledger assertions, and unresolved tensions into a token budget.',
        inputSchema: {
          type: 'object',
          properties: {
            project: {
              type: 'string',
              description: 'Project name to generate handoff context for'
            },
            context_budget: {
              type: 'number',
              description: 'Target token budget (default: 4000)',
              default: 4000
            }
          },
          required: ['project']
        }
      },
      {
        name: 'receive_handoff',
        description: 'Receive a context blob from another agent and confirm injection.',
        inputSchema: {
          type: 'object',
          properties: {
            context_blob: {
              type: 'string',
              description: 'The context blob from handoff()'
            }
          },
          required: ['context_blob']
        }
      },
      {
        name: 'session_replay',
        description: 'Get the full timeline of events for a session, in chronological order.',
        inputSchema: {
          type: 'object',
          properties: {
            project: {
              type: 'string',
              description: 'Project name'
            },
            session_id: {
              type: 'string',
              description: 'Session ID to replay'
            }
          },
          required: ['project', 'session_id']
        }
      },
      {
        name: 'session_diff',
        description: 'Compare two sessions and show what topics changed between them.',
        inputSchema: {
          type: 'object',
          properties: {
            project: {
              type: 'string',
              description: 'Project name'
            },
            session_id_a: {
              type: 'string',
              description: 'First session ID'
            },
            session_id_b: {
              type: 'string',
              description: 'Second session ID'
            }
          },
          required: ['project', 'session_id_a', 'session_id_b']
        }
      },
      {
        name: 'session_append_event',
        description: 'Append an event to a session timeline. Agents call this during a session to record decisions, experiments, rejections, and results in real-time. Subscribers to the replay resource receive real-time notifications.',
        inputSchema: {
          type: 'object',
          properties: {
            project: {
              type: 'string',
              description: 'Project name'
            },
            session_id: {
              type: 'string',
              description: 'Session ID to append the event to'
            },
            type: {
              type: 'string',
              description: 'Event type: decision, rejection, experiment, result, or info',
              enum: ['decision', 'rejection', 'experiment', 'result', 'info']
            },
            description: {
              type: 'string',
              description: 'Description of what happened'
            },
            tokens_spent: {
              type: 'number',
              description: 'Optional token cost of this event'
            }
          },
          required: ['project', 'session_id', 'type', 'description']
        }
      },
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
      if (result && result.session_id) {
        notifyResourceListChanged();
        const project = args.project;
        const uri = `engram://replay/${encodeURIComponent(project)}/${encodeURIComponent(result.session_id)}`;
        notifyResourceUpdated(uri);
      }
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

    case 'handoff':
      result = handoff(args.project, args.context_budget || 4000);
      break;

    case 'receive_handoff':
      result = receiveHandoff(args.context_blob);
      break;

    case 'session_replay':
      result = sessionReplay(args.project, args.session_id);
      break;

    case 'session_diff':
      result = sessionDiff(args.project, args.session_id_a, args.session_id_b);
      break;

    case 'session_append_event':
      result = await sessionAppendEvent(args.project, args.session_id, {
        type: args.type,
        description: args.description,
        tokens_spent: args.tokens_spent,
      });
      if (result && result.ok) {
        const uri = `engram://replay/${encodeURIComponent(result.project)}/${encodeURIComponent(result.session_id)}`;
        notifyResourceUpdated(uri);
      }
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
  const resources = [
    {
      uri: 'engram://stats',
      name: 'Engram Stats',
      description: 'Overview statistics of the Engram memory and ledger',
      mimeType: 'application/json'
    },
    {
      uri: 'engram://graph',
      name: 'Concept Graph',
      description: 'The full concept relationship graph',
      mimeType: 'application/json'
    }
  ];

  const projects = listProjects();
  if (Array.isArray(projects)) {
    for (const p of projects) {
      resources.push({
        uri: `engram://projects/${encodeURIComponent(p.project || p.name)}`,
        name: `Project: ${p.project || p.name}`,
        description: `Engram project bundle and context`,
        mimeType: 'application/json'
      });
    }
  }

  const recent = recentSessions(5);
  if (recent && Array.isArray(recent.results)) {
    for (const s of recent.results) {
      resources.push({
        uri: `engram://sessions/${encodeURIComponent(s.project)}/${encodeURIComponent(s.id)}`,
        name: `Session: ${s.summary?.substring(0, 60)}`,
        description: `Session from ${s.date}`,
        mimeType: 'application/json'
      });
    }
  }

  return { resources };
});

// List resource URI templates for dynamic resources
server.setRequestHandler(ListResourceTemplatesRequestSchema, async () => {
  return {
    resourceTemplates: [
      {
        uriTemplate: 'engram://sessions/{project}/{session_id}',
        name: 'Session Detail',
        description: 'Full session details by project and session ID',
        mimeType: 'application/json'
      },
      {
        uriTemplate: 'engram://replay/{project}/{session_id}',
        name: 'Session Replay',
        description: 'Chronological timeline of events in a session',
        mimeType: 'application/json'
      },
      {
        uriTemplate: 'engram://diff/{project}/{session_id_a}/{session_id_b}',
        name: 'Session Diff',
        description: 'Comparison between two sessions',
        mimeType: 'application/json'
      },
      {
        uriTemplate: 'engram://projects/{project}',
        name: 'Project Bundle',
        description: 'Pre-compiled context bundle for a project',
        mimeType: 'application/json'
      },
      {
        uriTemplate: 'engram://ledger/{plane}',
        name: 'Ledger Assertions',
        description: 'Active assertions for a given plane',
        mimeType: 'application/json'
      },
      {
        uriTemplate: 'engram://ledger/tensions',
        name: 'Ledger Tensions',
        description: 'Current unresolved contradictions in the ledger',
        mimeType: 'application/json'
      },
    ]
  };
});

// Handle resource read
server.setRequestHandler(ReadResourceRequestSchema, async (request) => {
  const { uri } = request.params;

  if (uri === 'engram://stats') {
    const stats = getStats();
    return {
      contents: [{ uri, mimeType: 'application/json', text: JSON.stringify(stats, null, 2) }]
    };
  }

  if (uri === 'engram://graph') {
    const summary = getGraphSummary();
    return {
      contents: [{ uri, mimeType: 'application/json', text: JSON.stringify(summary, null, 2) }]
    };
  }

  if (uri === 'engram://ledger/tensions') {
    const stats = getStats();
    const tensions = stats?.tensions || [];
    return {
      contents: [{ uri, mimeType: 'application/json', text: JSON.stringify({ tensions }, null, 2) }]
    };
  }

  const projectMatch = uri.match(/^engram:\/\/projects\/(.+)$/);
  if (projectMatch) {
    const project = decodeURIComponent(projectMatch[1]);
    const bundle = getBundle(project);
    return {
      contents: [{ uri, mimeType: 'application/json', text: JSON.stringify(bundle, null, 2) }]
    };
  }

  const sessionMatch = uri.match(/^engram:\/\/sessions\/([^/]+)\/(.+)$/);
  if (sessionMatch) {
    const project = decodeURIComponent(sessionMatch[1]);
    const sessionId = decodeURIComponent(sessionMatch[2]);
    const session = getSession(project, sessionId);
    return {
      contents: [{ uri, mimeType: 'application/json', text: JSON.stringify(session, null, 2) }]
    };
  }

  const replayMatch = uri.match(/^engram:\/\/replay\/([^/]+)\/(.+)$/);
  if (replayMatch) {
    const project = decodeURIComponent(replayMatch[1]);
    const sessionId = decodeURIComponent(replayMatch[2]);
    const replay = sessionReplay(project, sessionId);
    return {
      contents: [{ uri, mimeType: 'application/json', text: JSON.stringify(replay, null, 2) }]
    };
  }

  const diffMatch = uri.match(/^engram:\/\/diff\/([^/]+)\/([^/]+)\/(.+)$/);
  if (diffMatch) {
    const project = decodeURIComponent(diffMatch[1]);
    const sessionIdA = decodeURIComponent(diffMatch[2]);
    const sessionIdB = decodeURIComponent(diffMatch[3]);
    const diff = sessionDiff(project, sessionIdA, sessionIdB);
    return {
      contents: [{ uri, mimeType: 'application/json', text: JSON.stringify(diff, null, 2) }]
    };
  }

  const ledgerMatch = uri.match(/^engram:\/\/ledger\/(.+)$/);
  if (ledgerMatch) {
    const plane = decodeURIComponent(ledgerMatch[1]);
    if (plane === 'tensions') {
      const stats = getStats();
      return {
        contents: [{ uri, mimeType: 'application/json', text: JSON.stringify({ tensions: stats?.tensions || [] }, null, 2) }]
      };
    }
    const assertions = ledgerQuery(plane);
    return {
      contents: [{ uri, mimeType: 'application/json', text: JSON.stringify(assertions, null, 2) }]
    };
  }

  throw new Error(`Unknown resource: ${uri}`);
});

// Handle resource subscriptions
server.setRequestHandler(SubscribeRequestSchema, async (request) => {
  const { uri } = request.params;
  resourceSubscriptions.add(uri);
});

// Handle resource unsubscriptions
server.setRequestHandler(UnsubscribeRequestSchema, async (request) => {
  const { uri } = request.params;
  resourceSubscriptions.delete(uri);
});

function notifyResourceUpdated(uri) {
  if (resourceSubscriptions.has(uri)) {
    server.sendResourceUpdated({ uri }).catch(() => {});
  }
}

function notifyResourceListChanged() {
  server.sendResourceListChanged().catch(() => {});
}

// ─────────────────────────────────────────────────────────────
// Start Server
// ─────────────────────────────────────────────────────────────

async function main() {
  const transport = new StdioServerTransport();

  // Start consolidation watcher in background
  try {
    const { startWatcher } = require('./consolidate.js');
    startWatcher({ onUpdate: notifyResourceUpdated });
  } catch (e) {
    console.error('Engram consolidation watcher failed to start:', e.message);
  }

  await server.connect(transport);
  console.error('Engram MCP Server started');
}

main().catch((error) => {
  console.error('Fatal error:', error);
  process.exit(1);
});
