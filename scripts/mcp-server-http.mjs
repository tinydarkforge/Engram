#!/usr/bin/env node

/**
 * Memex MCP Server (Streamable HTTP)
 *
 * Exposes MCP tools over HTTP for remote agents.
 * Auth (optional): set MCP_API_KEY and use Authorization: Bearer <key> or X-API-Key.
 */

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { createMcpExpressApp } from '@modelcontextprotocol/sdk/server/express.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  ListPromptsRequestSchema,
  GetPromptRequestSchema,
  ListResourcesRequestSchema,
  ReadResourceRequestSchema,
  isInitializeRequest,
} from '@modelcontextprotocol/sdk/types.js';

import { randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';

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
} = require('./mcp-tools.js');
const { listPrompts, renderPrompt } = require('./mcp-prompts.js');

const MCP_PORT = process.env.MCP_PORT ? parseInt(process.env.MCP_PORT, 10) : 3000;
const MCP_BIND_ADDR = process.env.MCP_BIND_ADDR || '127.0.0.1';
const MCP_API_KEY = process.env.MCP_API_KEY || '';

function createServer() {
  const server = new Server(
    {
      name: 'memex',
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
                description: 'The search query (searches by semantic meaning)',
              },
              limit: {
                type: 'number',
                description: 'Maximum results to return (default: 10)',
                default: 10,
              },
              use_decay: {
                type: 'boolean',
                description: 'Apply time decay so recent sessions rank higher (default: true)',
                default: true,
              },
            },
            required: ['query'],
          },
        },
        {
          name: 'get_bundle',
          description: 'Get pre-compiled context bundle for a specific project. Includes description, tech stack, recent sessions, and key concepts.',
          inputSchema: {
            type: 'object',
            properties: {
              project: {
                type: 'string',
                description: 'Project name (e.g., "Memex", "DemoProject", "DevOps")',
              },
            },
            required: ['project'],
          },
        },
        {
          name: 'get_session',
          description: 'Get full session details by project and session ID.',
          inputSchema: {
            type: 'object',
            properties: {
              project: {
                type: 'string',
                description: 'Project name (e.g., "Memex", "DemoProject", "DevOps")',
              },
              session_id: {
                type: 'string',
                description: 'Session ID to retrieve',
              },
            },
            required: ['project', 'session_id'],
          },
        },
        {
          name: 'search_sessions',
          description: 'Keyword search across sessions by summary and topics.',
          inputSchema: {
            type: 'object',
            properties: {
              query: {
                type: 'string',
                description: 'Keyword query to search for',
              },
              project: {
                type: 'string',
                description: 'Optional project name to scope results',
              },
              limit: {
                type: 'number',
                description: 'Maximum results to return (default: 10)',
                default: 10,
              },
            },
            required: ['query'],
          },
        },
        {
          name: 'list_projects',
          description: 'List all projects indexed in Neural Memory with session counts.',
          inputSchema: {
            type: 'object',
            properties: {},
          },
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
                default: 10,
              },
            },
          },
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
                default: 30,
              },
            },
          },
        },
        {
          name: 'query_concept',
          description: 'Look up a concept in the knowledge graph. Returns related concepts and connection strengths.',
          inputSchema: {
            type: 'object',
            properties: {
              concept: {
                type: 'string',
                description: 'The concept to look up (e.g., "docker", "authentication")',
              },
            },
            required: ['concept'],
          },
        },
        {
          name: 'cross_project_search',
          description: 'Search across ALL projects semantically. Groups results by project with relevance scores. Great for finding related work across the entire codebase.',
          inputSchema: {
            type: 'object',
            properties: {
              query: {
                type: 'string',
                description: 'The search query (searches by semantic meaning across all projects)',
              },
              limit: {
                type: 'number',
                description: 'Maximum total results across all projects (default: 20)',
                default: 20,
              },
            },
            required: ['query'],
          },
        },
        {
          name: 'rebuild_index',
          description: 'Rebuild Memex indexes (bloom, git, embeddings).',
          inputSchema: {
            type: 'object',
            properties: {
              bloom: {
                type: 'boolean',
                description: 'Rebuild Bloom filter (default: true)',
                default: true,
              },
              git: {
                type: 'boolean',
                description: 'Rebuild git index (default: false)',
                default: false,
              },
              embeddings: {
                type: 'boolean',
                description: 'Regenerate embeddings (default: false)',
                default: false,
              },
            },
          },
        },
      ],
    };
  });

  server.setRequestHandler(ListPromptsRequestSchema, async () => {
    return {
      prompts: listPrompts(),
    };
  });

  server.setRequestHandler(GetPromptRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;
    return renderPrompt(name, args || {});
  });

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

      default:
        result = { error: `Unknown tool: ${name}` };
    }

    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify(result, null, 2),
        },
      ],
    };
  });

  server.setRequestHandler(ListResourcesRequestSchema, async () => {
    return {
      resources: [
        {
          uri: 'memex://stats',
          name: 'Neural Memory Stats',
          description: 'Overview statistics of the Neural Memory system',
          mimeType: 'application/json',
        },
        {
          uri: 'memex://graph',
          name: 'Concept Graph',
          description: 'The full concept relationship graph',
          mimeType: 'application/json',
        },
      ],
    };
  });

  server.setRequestHandler(ReadResourceRequestSchema, async (request) => {
    const { uri } = request.params;

    if (uri === 'memex://stats') {
      const stats = getStats();
      return {
        contents: [{ uri, mimeType: 'application/json', text: JSON.stringify(stats, null, 2) }],
      };
    }

    if (uri === 'memex://graph') {
      const summary = getGraphSummary();
      return {
        contents: [{ uri, mimeType: 'application/json', text: JSON.stringify(summary, null, 2) }],
      };
    }

    throw new Error(`Unknown resource: ${uri}`);
  });

  return server;
}

function getHeader(req, name) {
  const value = req.headers[name.toLowerCase()];
  if (Array.isArray(value)) return value[0];
  return value || '';
}

function requireApiKey(req, res, next) {
  if (!MCP_API_KEY) {
    next();
    return;
  }

  const authHeader = getHeader(req, 'authorization');
  const apiKeyHeader = getHeader(req, 'x-api-key');

  if (!authHeader && !apiKeyHeader) {
    res.status(401).send('Unauthorized');
    return;
  }

  let provided = apiKeyHeader;
  if (!provided && authHeader.startsWith('Bearer ')) {
    provided = authHeader.slice('Bearer '.length);
  }

  if (!provided) {
    res.status(403).send('Forbidden');
    return;
  }

  if (provided !== MCP_API_KEY) {
    res.status(403).send('Forbidden');
    return;
  }

  next();
}

const app = createMcpExpressApp();
const transports = new Map();

const mcpPostHandler = async (req, res) => {
  const sessionId = getHeader(req, 'mcp-session-id');

  try {
    let transport;

    if (sessionId && transports.has(sessionId)) {
      transport = transports.get(sessionId);
    } else if (!sessionId && isInitializeRequest(req.body)) {
      transport = new StreamableHTTPServerTransport({
        sessionIdGenerator: () => randomUUID(),
        onsessioninitialized: (sid) => {
          transports.set(sid, transport);
        },
      });

      transport.onclose = () => {
        const sid = transport.sessionId;
        if (sid && transports.has(sid)) {
          transports.delete(sid);
        }
      };

      const server = createServer();
      await server.connect(transport);
      await transport.handleRequest(req, res, req.body);
      return;
    } else {
      res.status(400).json({
        jsonrpc: '2.0',
        error: {
          code: -32000,
          message: 'Bad Request: No valid session ID provided',
        },
        id: null,
      });
      return;
    }

    await transport.handleRequest(req, res, req.body);
  } catch (error) {
    console.error('Error handling MCP request:', error);
    if (!res.headersSent) {
      res.status(500).json({
        jsonrpc: '2.0',
        error: {
          code: -32603,
          message: 'Internal server error',
        },
        id: null,
      });
    }
  }
};

const mcpGetHandler = async (req, res) => {
  const sessionId = getHeader(req, 'mcp-session-id');
  if (!sessionId || !transports.has(sessionId)) {
    res.status(400).send('Invalid or missing session ID');
    return;
  }

  const transport = transports.get(sessionId);
  await transport.handleRequest(req, res);
};

const mcpDeleteHandler = async (req, res) => {
  const sessionId = getHeader(req, 'mcp-session-id');
  if (!sessionId || !transports.has(sessionId)) {
    res.status(400).send('Invalid or missing session ID');
    return;
  }

  try {
    const transport = transports.get(sessionId);
    await transport.handleRequest(req, res);
  } catch (error) {
    console.error('Error handling session termination:', error);
    if (!res.headersSent) {
      res.status(500).send('Error processing session termination');
    }
  }
};

app.post('/mcp', requireApiKey, mcpPostHandler);
app.get('/mcp', requireApiKey, mcpGetHandler);
app.delete('/mcp', requireApiKey, mcpDeleteHandler);

app.listen(MCP_PORT, MCP_BIND_ADDR, (error) => {
  if (error) {
    console.error('Failed to start server:', error);
    process.exit(1);
  }
  console.log(`MCP Streamable HTTP Server listening on http://${MCP_BIND_ADDR}:${MCP_PORT}`);
});

process.on('SIGINT', async () => {
  for (const [sessionId, transport] of transports.entries()) {
    try {
      await transport.close();
    } catch (error) {
      console.error(`Error closing transport for session ${sessionId}:`, error);
    }
    transports.delete(sessionId);
  }
  process.exit(0);
});
