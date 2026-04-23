// Minimal in-memory DbDriver for unit tests. Records every call so tests can
// assert SQL text + bound params without touching D1.
import type { DbDriver } from "../../lib/db/driver";

export interface RecordedCall {
  method: "query" | "queryFirst" | "execute" | "batch";
  sql?: string | undefined;
  params?: unknown[] | undefined;
  statements?: Array<{ sql: string; params?: unknown[] }> | undefined;
}

export interface MockDriverOptions {
  /** Map sql substring → rows to return for query/queryFirst. */
  responses?: Array<{
    match: string;
    rows: unknown[];
  }>;
  executeMeta?: { changes: number; lastRowId: number | null };
}

export function createMockDriver(opts: MockDriverOptions = {}): {
  driver: DbDriver;
  calls: RecordedCall[];
} {
  const calls: RecordedCall[] = [];
  const responses = opts.responses ?? [];
  const executeMeta = opts.executeMeta ?? { changes: 1, lastRowId: 0 };

  function findRows(sql: string): unknown[] {
    for (const r of responses) {
      if (sql.includes(r.match)) return r.rows;
    }
    return [];
  }

  const driver: DbDriver = {
    async query<T>(sql: string, params?: unknown[]): Promise<T[]> {
      calls.push({ method: "query", sql, params });
      return findRows(sql) as T[];
    },
    async queryFirst<T>(sql: string, params?: unknown[]): Promise<T | null> {
      calls.push({ method: "queryFirst", sql, params });
      const rows = findRows(sql);
      return (rows[0] ?? null) as T | null;
    },
    async execute(sql, params) {
      calls.push({ method: "execute", sql, params });
      return executeMeta;
    },
    async batch(statements) {
      calls.push({ method: "batch", statements });
    },
  };

  return { driver, calls };
}
