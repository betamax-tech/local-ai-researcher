import { readFileSync } from 'fs';
import { resolve } from 'path';

import { Logger } from './logger.js';

export interface ProviderManifestEntry {
  lane: 'discovery' | 'read' | 'extract' | 'crawl';
  expected_version: string;
  runtime?: string;
  optional?: boolean;
  notes?: string;
}

export interface ProviderManifest {
  schema_version: number;
  manifest_path: string;
  providers: Record<string, ProviderManifestEntry>;
}

export function loadProviderManifest(
  manifestPath: string,
  logger: Logger
): ProviderManifest | null {
  try {
    const absolutePath = resolve(manifestPath);
    const raw = readFileSync(absolutePath, 'utf-8');
    const parsed = JSON.parse(raw) as {
      schema_version?: number;
      providers?: Record<string, ProviderManifestEntry>;
    };

    if (!parsed.providers || typeof parsed.providers !== 'object') {
      logger.warn('Provider manifest missing providers object', {
        component: 'provider-governance',
        manifestPath: absolutePath,
      });
      return null;
    }

    return {
      schema_version: parsed.schema_version ?? 1,
      manifest_path: absolutePath,
      providers: parsed.providers,
    };
  } catch (error) {
    logger.warn('Provider manifest unavailable', {
      component: 'provider-governance',
      manifestPath: resolve(manifestPath),
      error: error instanceof Error ? error.message : 'Unknown error',
    });
    return null;
  }
}

export function getManifestEntry(
  manifest: ProviderManifest | null,
  providerId: string
): ProviderManifestEntry | undefined {
  return manifest?.providers?.[providerId];
}
