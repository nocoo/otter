import type { DbDriver } from "./driver";

// Minimal subset of the Cloudflare Workers D1Database type we depend on.
// We re-declare it here to avoid pulling @cloudflare/workers-types into
// @otter/api's runtime types (web_legacy doesn't need it).
interface D1Meta {
  changes?: number;
  // biome-ignore lint/style/useNamingConvention: D1 meta field name
  last_row_id?: number;
}

interface D1PreparedStatement {
  bind(...values: unknown[]): D1PreparedStatement;
  first<T = unknown>(): Promise<T | null>;
  all<T = unknown>(): Promise<{ results: T[]; success: boolean; meta: D1Meta }>;
  run(): Promise<{ success: boolean; meta: D1Meta }>;
}

interface D1DatabaseLike {
  prepare(query: string): D1PreparedStatement;
  batch(statements: D1PreparedStatement[]): Promise<unknown[]>;
}

function prepareWithParams(
  db: D1DatabaseLike,
  sql: string,
  params?: unknown[],
): D1PreparedStatement {
  const stmt = db.prepare(sql);
  return params && params.length > 0 ? stmt.bind(...params) : stmt;
}

export function createBindingDriver(db: D1DatabaseLike): DbDriver {
  return {
    async query<T = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<T[]> {
      const result = await prepareWithParams(db, sql, params).all<T>();
      return result.results ?? [];
    },

    queryFirst<T = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<T | null> {
      return prepareWithParams(db, sql, params).first<T>();
    },

    async execute(sql, params) {
      const result = await prepareWithParams(db, sql, params).run();
      return {
        changes: result.meta.changes ?? 0,
        lastRowId: result.meta.last_row_id ?? null,
      };
    },

    async batch(statements) {
      if (statements.length === 0) return;
      const prepared = statements.map((s) => prepareWithParams(db, s.sql, s.params));
      await db.batch(prepared);
    },
  };
}
