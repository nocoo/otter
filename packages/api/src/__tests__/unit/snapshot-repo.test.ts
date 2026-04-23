import { describe, expect, it } from "vitest";
import {
  deleteSnapshotMeta,
  getSnapshotMeta,
  insertSnapshotStatement,
  listSnapshots,
  snapshotExists,
  snapshotR2Key,
} from "../../lib/snapshot-repo";
import { createMockDriver } from "./_mock-driver";

describe("snapshot-repo", () => {
  it("listSnapshots without before clamps limit and runs count in parallel", async () => {
    const sampleRow = {
      id: "s1",
      user_id: "u1",
      hostname: "h",
      platform: "darwin",
      arch: "arm64",
      username: "x",
      collector_count: 1,
      file_count: 2,
      list_count: 3,
      size_bytes: 100,
      snapshot_at: 10,
      uploaded_at: 20,
    };
    const { driver, calls } = createMockDriver({
      responses: [
        { match: "FROM snapshots\n       WHERE user_id = ?1\n       ORDER BY", rows: [sampleRow] },
        { match: "COUNT(*) as total", rows: [{ total: 1 }] },
      ],
    });

    const result = await listSnapshots(driver, "u1", { limit: 5 });

    expect(result.total).toBe(1);
    expect(result.rows).toEqual([sampleRow]);
    expect(result.nextBefore).toBe(null);
    const queryCall = calls.find((c) => c.method === "query");
    expect(queryCall?.params).toEqual(["u1", 5]);
  });

  it("listSnapshots with before adds uploaded_at filter and returns nextBefore when full", async () => {
    const rows = Array.from({ length: 3 }, (_, i) => ({
      id: `s${i}`,
      user_id: "u1",
      hostname: "h",
      platform: null,
      arch: null,
      username: null,
      collector_count: 0,
      file_count: 0,
      list_count: 0,
      size_bytes: 0,
      snapshot_at: 0,
      uploaded_at: 100 - i,
    }));
    const { driver, calls } = createMockDriver({
      responses: [
        { match: "uploaded_at < ?2", rows },
        { match: "COUNT(*)", rows: [{ total: 99 }] },
      ],
    });

    const result = await listSnapshots(driver, "u1", { limit: 3, before: 200 });

    expect(result.nextBefore).toBe(98); // last row uploaded_at
    expect(result.total).toBe(99);
    const queryCall = calls.find((c) => c.method === "query");
    expect(queryCall?.params).toEqual(["u1", 200, 3]);
  });

  it("limit is clamped between 1 and 100", async () => {
    const { driver, calls } = createMockDriver();
    await listSnapshots(driver, "u1", { limit: 9999 });
    expect(calls[0]?.params?.[1]).toBe(100);

    const next = createMockDriver();
    await listSnapshots(next.driver, "u1", { limit: 0 });
    expect(next.calls[0]?.params?.[1]).toBe(1);
  });

  it("getSnapshotMeta scopes by user_id", async () => {
    const { driver, calls } = createMockDriver();
    await getSnapshotMeta(driver, "u1", "s9");
    expect(calls[0]?.params).toEqual(["s9", "u1"]);
  });

  it("snapshotExists returns false on empty", async () => {
    const { driver } = createMockDriver();
    expect(await snapshotExists(driver, "u1", "s9")).toBe(false);
  });

  it("snapshotExists returns true when row present", async () => {
    const { driver } = createMockDriver({
      responses: [{ match: "SELECT id FROM snapshots", rows: [{ id: "s9" }] }],
    });
    expect(await snapshotExists(driver, "u1", "s9")).toBe(true);
  });

  it("deleteSnapshotMeta runs DELETE", async () => {
    const { driver, calls } = createMockDriver();
    await deleteSnapshotMeta(driver, "s9");
    expect(calls[0]?.sql).toContain("DELETE FROM snapshots");
    expect(calls[0]?.params).toEqual(["s9"]);
  });

  it("insertSnapshotStatement produces the expected 14-param INSERT", () => {
    const stmt = insertSnapshotStatement({
      id: "s1",
      userId: "u1",
      webhookId: "w1",
      meta: {
        hostname: "h",
        platform: "p",
        arch: "a",
        username: "u",
        collectorCount: 1,
        fileCount: 2,
        listCount: 3,
      },
      sizeBytes: 100,
      r2Key: "u1/s1.json",
      snapshotAt: 10,
      uploadedAt: 20,
    });
    expect(stmt.sql).toContain("INSERT INTO snapshots");
    expect(stmt.params).toHaveLength(14);
    expect(stmt.params[0]).toBe("s1");
    expect(stmt.params[11]).toBe("u1/s1.json");
  });

  it("snapshotR2Key formats user/id.json", () => {
    expect(snapshotR2Key("u1", "abc")).toBe("u1/abc.json");
  });
});
