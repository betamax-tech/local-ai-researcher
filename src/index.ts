#!/usr/bin/env node

/**
 * MCP stdio server entrypoint for Local Researcher — locked v1.
 *
 * Transport: stdio only (locked v1 decision).
 * Logging: stderr only — stdout is exclusively for MCP protocol messages.
 * Error codes: locked v1 taxonomy propagated in all error responses.
 */

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { zodToJsonSchema } from 'zod-to-json-schema';
import type { ZodTypeAny } from 'zod';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';

import { loadConfig } from './config.js';
import { Logger } from './lib/logger.js';
import { HttpClient } from './lib/http.js';
import { Cache } from './lib/cache.js';
import { SearxngProvider } from './providers/searxng.js';
import { ChainedSearchProvider } from './providers/chainedFallback.js';
import { JinaReaderProvider } from './providers/jinaReader.js';
import { createSearchTool } from './tools/search.js';
import { createReadTool } from './tools/read.js';
import { createGatherTool } from './tools/gather.js';
import { createHealthTool } from './tools/health.js';
import { ResearcherError } from './lib/errors.js';
import { SCHEMA_VERSION } from './domain/types.js';

/** Server version — kept in sync with package.json major.minor */
const SERVER_VERSION = '0.1.0';

/**
 * Main server initialization.
 * All logs go to stderr; stdout is reserved for MCP protocol.
 */
async function main(): Promise<void> {
  // Load and validate configuration (throws on invalid config)
  const config = loadConfig();

  // Logger: always stderr, always JSON in production
  const logger = new Logger(config.logging);

  logger.info('Starting Local Researcher MCP server', {
    component: 'main',
    version: SERVER_VERSION,
    transport: 'stdio',
    searxngEndpoint: config.providers.searxng.endpoint,
    jinaReaderEndpoint: config.providers.jinaReader.endpoint,
    logLevel: config.logging.level,
  });

  // --- Infrastructure ---
  const httpClient = new HttpClient(config.http);

  // --- Providers (behind boundary — no leakage to tool outputs) ---
  
  // Build the search provider chain: primary + configured fallbacks
  const searchProviders: SearchProvider[] = [
    new SearxngProvider(config.providers.searxng, httpClient, logger),
  ];

  // Add chained fallbacks if configured
  if (config.providers.searxngFallbacks && config.providers.searxngFallbacks.length > 0) {
    for (const fallbackConfig of config.providers.searxngFallbacks) {
      searchProviders.push(new SearxngProvider(fallbackConfig, httpClient, logger));
    }
  }

  // Use ChainedSearchProvider for multi-provider chains, single provider otherwise
  const searxngProvider = searchProviders.length > 1
    ? new ChainedSearchProvider(searchProviders, logger)
    : searchProviders[0]!;

  const jinaReaderProvider = new JinaReaderProvider(
    config.providers.jinaReader,
    httpClient,
    logger
  );

  // --- MCP Server ---
  const server = new Server(
    {
      name: 'local-researcher',
      version: SERVER_VERSION,
    },
    {
      capabilities: {
        tools: {},
      },
    }
  );

  // --- Cache (opt-in — only wired when enabled in config) ---
  const cache = config.cache.enabled
    ? new Cache({ path: config.cache.path, ttl: config.cache.ttl, enabled: true })
    : undefined;

  if (cache) {
    logger.info('Cache enabled', {
      component: 'main',
      path: config.cache.path,
      ttl: config.cache.ttl,
    });
  }

  // --- Tools ---
  const searchTool = createSearchTool(searxngProvider, logger, { cache });
  const readTool = createReadTool(jinaReaderProvider, logger, { cache });
  const gatherTool = createGatherTool(searxngProvider, jinaReaderProvider, logger, { cache });
  const healthTool = createHealthTool(searxngProvider, jinaReaderProvider, logger);

  // Registry uses a loose type to accommodate heterogeneous inputSchema shapes
  type ToolEntry = {
    name: string;
    description: string;
    inputSchema: unknown;
    handler(params: unknown): Promise<{ content: Array<{ type: string; text: string }>; isError?: boolean }>;
  };

  const toolRegistry = new Map<string, ToolEntry>([
    [searchTool.name, searchTool as ToolEntry],
    [readTool.name, readTool as ToolEntry],
    [gatherTool.name, gatherTool as ToolEntry],
    [healthTool.name, healthTool as ToolEntry],
  ]);

  // --- List tools handler ---
  server.setRequestHandler(ListToolsRequestSchema, async () => {
    logger.debug('List tools requested', { component: 'main' });

    return {
      tools: Array.from(toolRegistry.values()).map(tool => ({
        name: tool.name,
        description: tool.description,
        inputSchema: zodToJsonSchema(tool.inputSchema as ZodTypeAny),
      })),
    };
  });

  // --- Call tool handler ---
  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;

    logger.debug('Tool invoked', { component: 'main', tool: name });

    const tool = toolRegistry.get(name);

    if (!tool) {
      // Unknown tool — return a typed error envelope
      logger.warn('Unknown tool requested', { component: 'main', tool: name });

      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify({
              schema_version: SCHEMA_VERSION,
              ok: false,
              error: {
                code: 'ERR_VALIDATION',
                message: `Unknown tool: ${name}`,
                retryable: false,
              },
            }),
          },
        ],
        isError: true,
      };
    }

    try {
      // Delegate to tool handler — each tool returns its own typed envelope
      return await tool.handler(args);
    } catch (error) {
      // Only reaches here for unexpected/unhandled errors.
      // All domain errors should be caught inside each tool handler and
      // returned as ok:false envelopes without re-throwing.
      logger.error('Unhandled error in tool handler', {
        component: 'main',
        tool: name,
        error: error instanceof Error ? error.message : 'Unknown error',
        code: error instanceof ResearcherError ? error.code : undefined,
      });

      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify({
              schema_version: SCHEMA_VERSION,
              ok: false,
              error: {
                code: error instanceof ResearcherError
                  ? error.code
                  : 'ERR_VALIDATION',
                message: error instanceof Error ? error.message : 'Unknown error',
                retryable: error instanceof ResearcherError ? error.retryable : false,
                details: error instanceof ResearcherError ? error.details : undefined,
              },
            }),
          },
        ],
        isError: true,
      };
    }
  });

  // --- Graceful shutdown ---
  const shutdown = (signal: string): void => {
    logger.info(`Received ${signal}, shutting down gracefully`, { component: 'main' });
    process.exit(0);
  };

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));

  // --- Start stdio transport ---
  const transport = new StdioServerTransport();

  logger.info('Connecting to stdio transport', { component: 'main' });

  await server.connect(transport);

  logger.info('Local Researcher MCP server ready', {
    component: 'main',
    pid: process.pid,
    transport: 'stdio',
    version: SERVER_VERSION,
  });
}

// Start server — fatal errors write to stderr and exit 1
main().catch((error: unknown) => {
  // Must use process.stderr.write to avoid any stdout contamination
  process.stderr.write(
    JSON.stringify({
      level: 'error',
      message: 'Fatal error starting Local Researcher MCP server',
      error: error instanceof Error ? error.message : String(error),
      timestamp: new Date().toISOString(),
    }) + '\n'
  );
  process.exit(1);
});
