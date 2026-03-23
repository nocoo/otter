import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// Save original env
const originalEnv = { ...process.env };

// We need to re-import the module for each test to reset module-level state
function setupEnv() {
  process.env.CF_ACCOUNT_ID = "test-account";
  process.env.CF_D1_DATABASE_ID = "test-db";
  process.env.CF_D1_API_TOKEN = "test-token";
}

function makeD1Response<T>(results: T[], meta?: Partial<Record<string, number>>) {
  return {
    result: [
      {
        results,
        success: true,
        meta: {
          duration: 1,
          changes: meta?.changes ?? 0,
          last_row_id: meta?.last_row_id ?? 0,
          rows_read: results.length,
          rows_written: meta?.rows_written ?? 0,
        },
      },
    ],
    success: true,
    errors: [],
    messages: [],
  };
}

describe("D1 client", () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.resetModules();
    setupEnv();
    fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    process.env = { ...originalEnv };
    vi.unstubAllGlobals();
  });

  // --- env validation ---

  it("throws when CF_ACCOUNT_ID is missing", async () => {
    delete process.env.CF_ACCOUNT_ID;
    const { query } = await import("@/lib/cf/d1");
    await expect(query("SELECT 1")).rejects.toThrow("Missing Cloudflare D1 env vars");
  });

  it("throws when CF_D1_DATABASE_ID is missing", async () => {
    delete process.env.CF_D1_DATABASE_ID;
    const { query } = await import("@/lib/cf/d1");
    await expect(query("SELECT 1")).rejects.toThrow("Missing Cloudflare D1 env vars");
  });

  it("throws when CF_D1_API_TOKEN is missing", async () => {
    delete process.env.CF_D1_API_TOKEN;
    const { query } = await import("@/lib/cf/d1");
    await expect(query("SELECT 1")).rejects.toThrow("Missing Cloudflare D1 env vars");
  });

  // --- query ---

  it("query returns all rows", async () => {
    const rows = [{ id: 1, name: "a" }, { id: 2, name: "b" }];
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => makeD1Response(rows),
    });

    const { query } = await import("@/lib/cf/d1");
    const result = await query("SELECT * FROM users");

    expect(result).toEqual(rows);
    expect(fetchMock).toHaveBeenCalledOnce();

    // biome-ignore lint/style/noNonNullAssertion: mock array access in test
    const [url, opts] = fetchMock.mock.calls[0]!;
    expect(url).toContain("test-account");
    expect(url).toContain("test-db");
    expect(opts.method).toBe("POST");
    expect(opts.headers.Authorization).toBe("Bearer test-token");

    const body = JSON.parse(opts.body);
    expect(body.sql).toBe("SELECT * FROM users");
    expect(body.params).toBeUndefined();
  });

  it("query sends params when provided", async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => makeD1Response([{ id: 1 }]),
    });

    const { query } = await import("@/lib/cf/d1");
    await query("SELECT * FROM users WHERE id = ?1", ["user-1"]);

    // biome-ignore lint/style/noNonNullAssertion: mock array access in test
    const body = JSON.parse(fetchMock.mock.calls[0]![1].body);
    expect(body.params).toEqual(["user-1"]);
  });

  // --- queryFirst ---

  it("queryFirst returns first row", async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => makeD1Response([{ id: 1 }, { id: 2 }]),
    });

    const { queryFirst } = await import("@/lib/cf/d1");
    const result = await queryFirst("SELECT * FROM users");

    expect(result).toEqual({ id: 1 });
  });

  it("queryFirst returns null when no rows", async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => makeD1Response([]),
    });

    const { queryFirst } = await import("@/lib/cf/d1");
    const result = await queryFirst("SELECT * FROM users WHERE id = ?1", ["none"]);

    expect(result).toBeNull();
  });

  // --- execute ---

  it("execute returns changes and lastRowId", async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => makeD1Response([], { changes: 1, last_row_id: 42 }),
    });

    const { execute } = await import("@/lib/cf/d1");
    const result = await execute("INSERT INTO users (name) VALUES (?1)", ["test"]);

    expect(result).toEqual({ changes: 1, lastRowId: 42 });
  });

  // --- batch ---

  it("batch executes statements sequentially", async () => {
    fetchMock
      .mockResolvedValueOnce({
        ok: true,
        json: async () => makeD1Response([]),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => makeD1Response([]),
      });

    const { batch } = await import("@/lib/cf/d1");
    await batch([
      { sql: "INSERT INTO a (x) VALUES (?1)", params: [1] },
      { sql: "INSERT INTO b (y) VALUES (?1)", params: [2] },
    ]);

    expect(fetchMock).toHaveBeenCalledTimes(2);

    // biome-ignore lint/style/noNonNullAssertion: mock array access in test
    const body1 = JSON.parse(fetchMock.mock.calls[0]![1].body);
    expect(body1.sql).toBe("INSERT INTO a (x) VALUES (?1)");
    expect(body1.params).toEqual([1]);

    // biome-ignore lint/style/noNonNullAssertion: mock array access in test
    const body2 = JSON.parse(fetchMock.mock.calls[1]![1].body);
    expect(body2.sql).toBe("INSERT INTO b (y) VALUES (?1)");
    expect(body2.params).toEqual([2]);
  });

  it("batch omits params when empty", async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => makeD1Response([]),
    });

    const { batch } = await import("@/lib/cf/d1");
    await batch([{ sql: "DELETE FROM cache" }]);

    // biome-ignore lint/style/noNonNullAssertion: mock array access in test
    const body = JSON.parse(fetchMock.mock.calls[0]![1].body);
    expect(body.params).toBeUndefined();
  });

  // --- error handling ---

  it("throws on HTTP error", async () => {
    fetchMock.mockResolvedValue({
      ok: false,
      status: 500,
      text: async () => "Internal Server Error",
    });

    const { query } = await import("@/lib/cf/d1");
    await expect(query("SELECT 1")).rejects.toThrow("D1 API error (500)");
  });

  it("throws on D1 query failure (success: false)", async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({
        result: [{ results: [], success: false, meta: {} }],
        success: false,
        errors: [{ code: 1, message: "syntax error" }],
        messages: [],
      }),
    });

    const { query } = await import("@/lib/cf/d1");
    await expect(query("INVALID SQL")).rejects.toThrow("D1 query failed: syntax error");
  });

  it("throws on batch D1 failure", async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({
        result: [],
        success: false,
        errors: [{ code: 1, message: "batch error" }],
        messages: [],
      }),
    });

    const { batch } = await import("@/lib/cf/d1");
    await expect(batch([{ sql: "BAD SQL" }])).rejects.toThrow("D1 batch failed: batch error");
  });

  // --- retry logic ---

  it("retries on transient failures then succeeds", async () => {
    const rows = [{ id: 1 }];
    fetchMock
      .mockRejectedValueOnce(new Error("network error"))
      .mockResolvedValueOnce({
        ok: true,
        json: async () => makeD1Response(rows),
      });

    const { query } = await import("@/lib/cf/d1");
    const result = await query("SELECT 1");

    expect(result).toEqual(rows);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("exhausts retries and throws last error", async () => {
    fetchMock.mockRejectedValue(new Error("persistent failure"));

    const { query } = await import("@/lib/cf/d1");
    await expect(query("SELECT 1")).rejects.toThrow("persistent failure");

    // 3 retries total
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });
});
