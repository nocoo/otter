import { describe, expect, it, vi } from "vitest";

import { createBindingDriver } from "../../lib/db/d1-binding";
import { createHttpDriver } from "../../lib/db/d1-http";

// Bridges the local fake D1 type to the driver's structural shape.
// Test-only escape hatch.
type AnyDb = Parameters<typeof createBindingDriver>[0];

vi.mock("../../lib/cf/d1", () => ({
  query: vi.fn(async (sql: string, params?: unknown[]) => [{ sql, params }]),
  queryFirst: vi.fn(async (sql: string, params?: unknown[]) => ({ sql, params })),
  execute: vi.fn(async () => ({ changes: 3, lastRowId: 7 })),
  batch: vi.fn(async () => undefined),
}));

describe("createHttpDriver", () => {
  it("forwards query/queryFirst/execute/batch to cf/d1 module", async () => {
    const driver = createHttpDriver();

    await expect(driver.query("SELECT 1", [1])).resolves.toEqual([
      { sql: "SELECT 1", params: [1] },
    ]);
    await expect(driver.queryFirst("SELECT 2")).resolves.toEqual({
      sql: "SELECT 2",
      params: undefined,
    });
    await expect(driver.execute("DELETE 1")).resolves.toEqual({ changes: 3, lastRowId: 7 });
    await expect(driver.batch([{ sql: "X" }])).resolves.toBeUndefined();
  });
});

describe("createBindingDriver", () => {
  function makeFakeDb() {
    const calls: Array<{ kind: string; sql?: string; bound?: unknown[] }> = [];
    let nextResults: unknown[] = [];
    let nextFirst: unknown = null;
    let nextRunMeta: { changes?: number; last_row_id?: number } = {};

    function makeStmt(sql: string) {
      let bound: unknown[] = [];
      const stmt = {
        bind(...values: unknown[]) {
          bound = values;
          return stmt;
        },
        async first() {
          calls.push({ kind: "first", sql, bound });
          return nextFirst;
        },
        async all() {
          calls.push({ kind: "all", sql, bound });
          return { results: nextResults, success: true, meta: {} };
        },
        async run() {
          calls.push({ kind: "run", sql, bound });
          return { success: true, meta: nextRunMeta };
        },
      };
      return stmt;
    }

    const db = {
      prepare: (sql: string) => makeStmt(sql),
      batch: async (stmts: unknown[]) => {
        calls.push({ kind: "batch", bound: [stmts.length] });
        return [];
      },
    };

    return {
      db,
      calls,
      stage(opts: {
        results?: unknown[];
        first?: unknown;
        runMeta?: { changes?: number; last_row_id?: number };
      }) {
        if (opts.results !== undefined) nextResults = opts.results;
        if (opts.first !== undefined) nextFirst = opts.first;
        if (opts.runMeta !== undefined) nextRunMeta = opts.runMeta;
      },
    };
  }

  it("query binds params and returns results array", async () => {
    const fake = makeFakeDb();
    fake.stage({ results: [{ a: 1 }] });
    const driver = createBindingDriver(fake.db as AnyDb);

    const rows = await driver.query("SELECT * FROM t WHERE x = ?1", ["v"]);
    expect(rows).toEqual([{ a: 1 }]);
    expect(fake.calls[0]).toEqual({
      kind: "all",
      sql: "SELECT * FROM t WHERE x = ?1",
      bound: ["v"],
    });
  });

  it("queryFirst returns the first row or null", async () => {
    const fake = makeFakeDb();
    fake.stage({ first: { a: 9 } });
    const driver = createBindingDriver(fake.db as AnyDb);
    expect(await driver.queryFirst("SELECT 1")).toEqual({ a: 9 });
  });

  it("execute returns changes/lastRowId from meta", async () => {
    const fake = makeFakeDb();
    fake.stage({ runMeta: { changes: 5, last_row_id: 42 } });
    const driver = createBindingDriver(fake.db as AnyDb);
    expect(await driver.execute("DELETE FROM t")).toEqual({ changes: 5, lastRowId: 42 });
  });

  it("execute defaults missing meta to changes:0/lastRowId:null", async () => {
    const fake = makeFakeDb();
    const driver = createBindingDriver(fake.db as AnyDb);
    expect(await driver.execute("DELETE FROM t")).toEqual({ changes: 0, lastRowId: null });
  });

  it("query without params skips bind()", async () => {
    const fake = makeFakeDb();
    const driver = createBindingDriver(fake.db as AnyDb);
    await driver.query("SELECT 1");
    expect(fake.calls[0]?.bound).toEqual([]);
  });

  it("batch routes through native db.batch when statements present", async () => {
    const fake = makeFakeDb();
    const driver = createBindingDriver(fake.db as AnyDb);
    await driver.batch([{ sql: "INSERT 1", params: ["a"] }, { sql: "UPDATE 2" }]);
    const batchCall = fake.calls.find((c) => c.kind === "batch");
    expect(batchCall).toBeDefined();
    expect(batchCall?.bound).toEqual([2]);
  });

  it("batch is a no-op when statements is empty", async () => {
    const fake = makeFakeDb();
    const driver = createBindingDriver(fake.db as AnyDb);
    await driver.batch([]);
    expect(fake.calls).toEqual([]);
  });
});
