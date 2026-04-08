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
import type { SearchProvider, ReaderProvider, ExtractProvider } from '../providers/interfaces.js';
import { ResearcherError, SsrfError } from '../lib/errors.js';
import { Logger } from '../lib/logger.js';
import type { ToolResponseEnvelope } from '../domain/types.js';
import type { ProviderManifest } from '../lib/provider-governance.js';
import { getManifestEntry } from '../lib/provider-governance.js';

// ---------------------------------------------------------------------------
// Input schema
// ---------------------------------------------------------------------------

/**
 * Health tool input — no required parameters.
 */
export const HealthInputSchema = z.object({
  /** Which provider to check (default: 'all') */
  provider: z.enum(['searxng', 'jinaReader', 'scrapling', 'all']).optional().default('all'),
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
  searxngProvider: SearchProvider | null,
  jinaReaderProvider: ReaderProvider | null,
  scraplingProviderOrLogger: ExtractProvider | Logger | null,
  loggerOrManifest?: Logger | ProviderManifest | null,
  manifestMaybe?: ProviderManifest | null
) {
  const scraplingProvider =
    loggerOrManifest && 'info' in loggerOrManifest
      ? (scraplingProviderOrLogger as ExtractProvider | null)
      : null;
  const logger =
    loggerOrManifest && 'info' in loggerOrManifest
      ? (loggerOrManifest as Logger)
      : (scraplingProviderOrLogger as Logger);
  const manifest =
    loggerOrManifest && 'info' in loggerOrManifest
      ? manifestMaybe
      : ((loggerOrManifest as ProviderManifest | null | undefined) ?? undefined);
  const includeScrapling = Boolean(loggerOrManifest && 'info' in loggerOrManifest);

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

        const makeEntry = (
          providerId: string,
          name: string,
          lane: 'discovery' | 'read' | 'extract' | 'crawl',
          health: {
            status: 'connected' | 'degraded' | 'unavailable' | 'error';
            latency_ms?: number;
            error?: string;
            error_code?: string;
            detected_version?: string;
            runtime?: string;
          },
          fallbackOptional: boolean = false
        ): ProviderHealthEntry => {
          const manifestEntry = getManifestEntry(manifest ?? null, providerId);
          return {
            provider_id: providerId,
            name,
            lane,
            status: health.status,
            latency_ms: health.latency_ms,
            error: health.error,
            error_code: health.error_code,
            optional: manifestEntry?.optional ?? fallbackOptional,
            expected_version: manifestEntry?.expected_version,
            detected_version: health.detected_version,
            runtime: health.runtime ?? manifestEntry?.runtime,
          };
        };

        // --- SearxNG ---
        if (input.provider === 'searxng' || input.provider === 'all') {
          if (searxngProvider) {
            try {
              const health = await searxngProvider.checkHealth();
              servers.push(makeEntry('searxng', searxngProvider.name, 'discovery', health));
            } catch (error) {
              // checkHealth() should not throw — this is a defensive fallback
               servers.push(makeEntry('searxng', searxngProvider.name, 'discovery', {
                 status: error instanceof SsrfError ? 'error' : 'unavailable',
                 error: error instanceof Error ? error.message : 'Unknown error',
                 error_code: error instanceof SsrfError ? error.code : undefined,
               }));
            }
          } else {
            servers.push(makeEntry('searxng', 'SearxNG', 'discovery', {
              status: 'unavailable',
              error: 'Not configured',
            }));
          }
        }

        // --- Jina Reader ---
        if (input.provider === 'jinaReader' || input.provider === 'all') {
          if (jinaReaderProvider) {
            try {
              const health = await jinaReaderProvider.checkHealth();
              servers.push(makeEntry('jina-reader', jinaReaderProvider.name, 'read', health));
            } catch (error) {
              // checkHealth() should not throw — this is a defensive fallback
              servers.push(makeEntry('jina-reader', jinaReaderProvider.name, 'read', {
                status: error instanceof SsrfError ? 'error' : 'unavailable',
                error: error instanceof Error ? error.message : 'Unknown error',
                error_code: error instanceof SsrfError ? error.code : undefined,
              }));
            }
          } else {
            servers.push(makeEntry('jina-reader', 'Jina Reader', 'read', {
              status: 'unavailable',
              error: 'Not configured',
            }));
          }
        }

        // --- Scrapling ---
        if (includeScrapling && (input.provider === 'scrapling' || input.provider === 'all')) {
          if (scraplingProvider) {
            try {
              const health = await scraplingProvider.checkHealth();
              servers.push(makeEntry('scrapling', scraplingProvider.name, 'extract', health, true));
            } catch (error) {
              servers.push(makeEntry('scrapling', scraplingProvider.name, 'extract', {
                status: error instanceof SsrfError ? 'error' : 'unavailable',
                error: error instanceof Error ? error.message : 'Unknown error',
                error_code: error instanceof SsrfError ? error.code : undefined,
              }, true));
            }
          } else {
            servers.push(makeEntry('scrapling', 'Scrapling', 'extract', {
              status: 'unavailable',
              error: 'Not configured',
            }, true));
          }
        }

        // Determine overall status
        const requiredServers = servers.filter(s => !s.optional);
        const connectedCount = requiredServers.filter(s => s.status === 'connected').length;
        const totalCount = requiredServers.length;
        const optionalFailures = servers.filter(s => s.optional && s.status !== 'connected').length;

        let status: 'healthy' | 'degraded' | 'unhealthy';
        if (connectedCount === totalCount && totalCount > 0 && optionalFailures === 0) {
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
          provider_governance: {
            manifest_loaded: Boolean(manifest),
            manifest_path: manifest?.manifest_path,
            tracked_providers: manifest ? Object.keys(manifest.providers).length : 0,
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
