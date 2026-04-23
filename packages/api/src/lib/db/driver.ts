// DbDriver — abstract D1 access so the same routes/repos can target either:
//   - Cloudflare HTTP D1 REST API (used by web_legacy via @otter/api in Node)
//   - D1Database binding (used by @otter/worker on Cloudflare Workers)
//
// The interface mirrors the minimum surface our SQL needs.

export interface DbDriver {
  /** Execute a SELECT and return all rows. */
  query<T = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<T[]>;

  /** Execute a SELECT and return the first row, or null. */
  queryFirst<T = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<T | null>;

  /** Execute INSERT/UPDATE/DELETE and return change metadata. */
  execute(sql: string, params?: unknown[]): Promise<{ changes: number; lastRowId: number | null }>;

  /** Execute multiple statements. Implementations may use native batch when available. */
  batch(statements: Array<{ sql: string; params?: unknown[] }>): Promise<void>;
}
