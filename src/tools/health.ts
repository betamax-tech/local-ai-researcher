/**
 * Health tool — locked v1 implementation.
 *
 * Reports MCP server readiness and provider health.
 * Output matches the locked HealthResult contract from the PRD.
 */

import { randomUUID } from 'crypto';
import { z } from 'zod';
import type { HealthResult, ProviderHealthEntry, ResponseMeta } from '../domain/types.js';
import { SCHEMA_VERSION } from '../domain/types.js';
import type { SearxngProvider } from '../providers/searxng.js';
import type { JinaReaderProvider } from '../providers/jinaReader.js';
import { ResearcherError } from '../lib/errors.js';
import { Logger } from '../lib/logger.js';
import type { ToolResponseEnvelope } from '../domain/types.js';

// ---------------------------------------------------------------------------
// Input schema
// ---------------------------------------------------------------------------

/**
 * Health tool input — no required parameters.
 */
export const HealthInputSchema = z.object({
  /** Which provider to check (default: 'all') */
  provider: z.enum(['searxng', 'jinaReader', 'all']).optional().default('all'),
});

export type HealthInput = z.infer<typeof HealthInputSchema>;

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

/**
 * Create the health tool.
 *
 * @param searxngProvider - SearxNG provider (or null if not configured)
 * @param jinaReaderProvider - Jina Reader provider (or null if not configured)
 * @param logger - Logger
 */
export function createHealthTool(
  searxngProvider: SearxngProvider | null,
  jinaReaderProvider: JinaReaderProvider | null,
  logger: Logger
) {
  return {
    name: 'health',
    description:
      'Check the health of configured providers. ' +
      'Returns MCP server status, provider connectivity, and resource usage.',
    inputSchema: HealthInputSchema,

    /**
     * Handle a health check request.
     */
    async handler(
      params: unknown
    ): Promise<{ content: Array<{ type: string; text: string }>; isError?: boolean }> {
      const input = HealthInputSchema.parse(params);
      const requestId = randomUUID();
      const timestamp = new Date().toISOString();

      const meta: ResponseMeta = {
        request_id: requestId,
        timestamp,
        provider_id: 'health',
        provider_name: 'Health Check',
        applied_limits: {},
      };

      logger.info('Health tool invoked', {
        component: 'health',
        provider: input.provider,
        request_id: requestId,
      });

      try {
        const servers: ProviderHealthEntry[] = [];

        // --- SearxNG ---
        if (input.provider === 'searxng' || input.provider === 'all') {
          if (searxngProvider) {
            try {
              const healthy = await searxngProvider.isHealthy();
              servers.push({
                name: searxngProvider.name,
                status: healthy ? 'connected' : 'error',
                error: healthy ? undefined : 'Health check returned unhealthy',
              });
            } catch (error) {
              servers.push({
                name: searxngProvider.name,
                status: 'error',
                error: error instanceof Error ? error.message : 'Unknown error',
              });
            }
          } else {
            servers.push({ name: 'SearxNG', status: 'error', error: 'Not configured' });
          }
        }

        // --- Jina Reader ---
        if (input.provider === 'jinaReader' || input.provider === 'all') {
          if (jinaReaderProvider) {
            try {
              const healthy = await jinaReaderProvider.isHealthy();
              servers.push({
                name: jinaReaderProvider.name,
                status: healthy ? 'connected' : 'error',
                error: healthy ? undefined : 'Health check returned unhealthy',
              });
            } catch (error) {
              servers.push({
                name: jinaReaderProvider.name,
                status: 'error',
                error: error instanceof Error ? error.message : 'Unknown error',
              });
            }
          } else {
            servers.push({ name: 'Jina Reader', status: 'error', error: 'Not configured' });
          }
        }

        // Determine overall status
        const connectedCount = servers.filter(s => s.status === 'connected').length;
        const totalCount = servers.length;

        let status: 'healthy' | 'degraded' | 'unhealthy';
        if (connectedCount === totalCount && totalCount > 0) {
          status = 'healthy';
        } else if (connectedCount > 0) {
          status = 'degraded';
        } else {
          status = 'unhealthy';
        }

        // Memory usage
        const memUsage = process.memoryUsage();
        const memoryMB = Math.round(memUsage.rss / 1024 / 1024);

        const result: HealthResult = {
          status,
          mcp: {
            stdio: { ready: true, version: '1.0.0' },
            servers,
          },
          resources: {
            memoryMB,
            cwd: process.cwd(),
          },
          timestamp,
        };

        logger.info('Health tool completed', {
          component: 'health',
          status,
          connectedCount,
          totalCount,
          memoryMB,
          request_id: requestId,
        });

        const envelope: ToolResponseEnvelope<HealthResult> = {
          schema_version: SCHEMA_VERSION,
          ok: true,
          meta,
          result,
        };

        return {
          content: [{ type: 'text', text: JSON.stringify(envelope, null, 2) }],
        };
      } catch (error) {
        logger.error('Health tool failed', {
          component: 'health',
          error: error instanceof Error ? error.message : 'Unknown error',
          request_id: requestId,
        });

        const envelope: ToolResponseEnvelope<never> = {
          schema_version: SCHEMA_VERSION,
          ok: false,
          meta,
          error: {
            code: error instanceof ResearcherError
              ? error.code
              : 'ERR_HEALTH_CHECK_FAILED',
            message: error instanceof Error ? error.message : 'Unknown error',
            retryable: error instanceof ResearcherError ? error.retryable : true,
            details: error instanceof ResearcherError ? error.details : undefined,
          },
        };

        return {
          content: [{ type: 'text', text: JSON.stringify(envelope, null, 2) }],
          isError: true,
        };
      }
    },
  };
}
