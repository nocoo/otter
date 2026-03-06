import { z } from "zod/v4";

// --- Environment validation ---

const cfEnvSchema = z.object({
  CF_ACCOUNT_ID: z.string().min(1),
  CF_D1_DATABASE_ID: z.string().min(1),
  CF_D1_API_TOKEN: z.string().min(1),
});

function getConfig() {
  const result = cfEnvSchema.safeParse(process.env);
  if (!result.success) {
    throw new Error(
      `Missing Cloudflare D1 env vars: ${result.error.issues.map((i) => i.path.join(".")).join(", ")}`,
    );
  }
  return result.data;
}

// --- Types ---

interface D1QueryResult<T = Record<string, unknown>> {
  results: T[];
  success: boolean;
  meta: {
    duration: number;
    changes: number;
    last_row_id: number;
    rows_read: number;
    rows_written: number;
  };
}

interface D1Response<T = Record<string, unknown>> {
  result: D1QueryResult<T>[];
  success: boolean;
  errors: Array<{ code: number; message: string }>;
  messages: string[];
}

// --- Retry logic ---

const MAX_RETRIES = 3;
const BASE_DELAY_MS = 200;

async function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function withRetry<T>(fn: () => Promise<T>): Promise<T> {
  let lastError: Error | undefined;
  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));
      if (attempt < MAX_RETRIES - 1) {
        const delay = BASE_DELAY_MS * Math.pow(2, attempt);
        await sleep(delay);
      }
    }
  }
  throw lastError;
}

// --- Core D1 client ---

async function executeRaw<T = Record<string, unknown>>(
  sql: string,
  params?: unknown[],
): Promise<D1QueryResult<T>> {
  const config = getConfig();
  const url = `https://api.cloudflare.com/client/v4/accounts/${config.CF_ACCOUNT_ID}/d1/database/${config.CF_D1_DATABASE_ID}/query`;

  const body: { sql: string; params?: unknown[] } = { sql };
  if (params && params.length > 0) {
    body.params = params;
  }

  const response = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${config.CF_D1_API_TOKEN}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`D1 API error (${response.status}): ${text}`);
  }

  const data: D1Response<T> = await response.json();
  if (!data.success) {
    throw new Error(
      `D1 query failed: ${data.errors.map((e) => e.message).join(", ")}`,
    );
  }

  return data.result[0]!;
}

// --- Public API ---

/** Execute a query and return all matching rows */
export async function query<T = Record<string, unknown>>(
  sql: string,
  params?: unknown[],
): Promise<T[]> {
  const result = await withRetry(() => executeRaw<T>(sql, params));
  return result.results;
}

/** Execute a query and return the first row, or null */
export async function queryFirst<T = Record<string, unknown>>(
  sql: string,
  params?: unknown[],
): Promise<T | null> {
  const rows = await query<T>(sql, params);
  return rows[0] ?? null;
}

/** Execute a mutation (INSERT, UPDATE, DELETE) and return metadata */
export async function execute(
  sql: string,
  params?: unknown[],
): Promise<{ changes: number; lastRowId: number }> {
  const result = await withRetry(() => executeRaw(sql, params));
  return {
    changes: result.meta.changes,
    lastRowId: result.meta.last_row_id,
  };
}

/** Execute multiple statements in a batch (each runs in sequence) */
export async function batch(
  statements: Array<{ sql: string; params?: unknown[] }>,
): Promise<void> {
  const config = getConfig();
  const url = `https://api.cloudflare.com/client/v4/accounts/${config.CF_ACCOUNT_ID}/d1/database/${config.CF_D1_DATABASE_ID}/query`;

  // D1 REST API doesn't support batch natively, so we run sequentially
  for (const stmt of statements) {
    await withRetry(async () => {
      const body: { sql: string; params?: unknown[] } = { sql: stmt.sql };
      if (stmt.params && stmt.params.length > 0) {
        body.params = stmt.params;
      }

      const response = await fetch(url, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${config.CF_D1_API_TOKEN}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(body),
      });

      if (!response.ok) {
        const text = await response.text();
        throw new Error(`D1 API error (${response.status}): ${text}`);
      }

      const data: D1Response = await response.json();
      if (!data.success) {
        throw new Error(
          `D1 batch failed: ${data.errors.map((e) => e.message).join(", ")}`,
        );
      }
    });
  }
}
