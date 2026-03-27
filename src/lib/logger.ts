/**
 * Stderr-only logger for Local Researcher
 */

import type { LoggingConfig } from '../domain/types.js';

export interface LogMeta {
  /** Log level */
  level?: 'debug' | 'info' | 'warn' | 'error';

  /** Request ID (for correlation) */
  requestId?: string;

  /** Component/module name */
  component?: string;

  /** Additional context */
  [key: string]: unknown;
}

export class Logger {
  private config: LoggingConfig;

  constructor(config: LoggingConfig) {
    this.config = config;
  }

  private shouldLog(level: string): boolean {
    const levels = ['debug', 'info', 'warn', 'error'];
    return levels.indexOf(level) >= levels.indexOf(this.config.level);
  }

  private format(level: string, message: string, meta: LogMeta = {}): void {
    if (!this.shouldLog(level)) {
      return;
    }

    const entry: Record<string, unknown> = {
      level,
      message,
      ...meta,
    };

    if (this.config.timestamp) {
      entry.timestamp = new Date().toISOString();
    }

    if (meta.component) {
      entry.component = meta.component;
    }

    if (this.config.json) {
      // JSON format for structured logging
      console.error(JSON.stringify(entry));
    } else {
      // Human-readable format
      const parts: string[] = [level.toUpperCase(), message];
      if (meta.component) {
        parts.push(`[${meta.component}]`);
      }
      console.error(parts.join(' '));
    }
  }

  debug(message: string, meta?: LogMeta): void {
    this.format('debug', message, meta);
  }

  info(message: string, meta?: LogMeta): void {
    this.format('info', message, meta);
  }

  warn(message: string, meta?: LogMeta): void {
    this.format('warn', message, meta);
  }

  error(message: string, meta?: LogMeta): void {
    this.format('error', message, meta);
  }
}
