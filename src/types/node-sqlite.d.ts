/**
 * Type declarations for node:sqlite (experimental)
 * 
 * Node.js 22.5+ includes experimental SQLite support via node:sqlite.
 * These types are minimal and cover only what we use in src/lib/cache.ts.
 */

declare module 'node:sqlite' {
  export class DatabaseSync {
    constructor(path: string);
    exec(sql: string): void;
    prepare(sql: string): StatementSync;
    close(): void;
  }

  export interface StatementSync {
    run(...params: unknown[]): DatabaseSync;
    get(...params: unknown[]): unknown | undefined;
  }
}
