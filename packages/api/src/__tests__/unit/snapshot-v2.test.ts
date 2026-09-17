import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { DatabaseSync, type SQLInputValue } from "node:sqlite";
import type { Snapshot } from "@otter/core";
import { Hono } from "hono";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { AppEnv } from "../../lib/app-env";
import type { DbDriver } from "../../lib/db/driver";
import type { R2BucketLike } from "../../lib/r2";
import {
  isValidSnapshotPayload,
  sha256,
  validateSnapshotContents,
} from "../../lib/snapshot-payload";
import { listDevices, listSnapshots } from "../../lib/snapshot-repo";
import { storeSnapshot } from "../../lib/snapshot-storage";
import { createApiSnapshotsRoute } from "../../routes/api-snapshots";

function required<T>(value: T | null | undefined): T {
  assert(value !== null && value !== undefined, "Required fixture value is missing");
  return value;
}

const fixture = (): Snapshot =>
  JSON.parse(readFileSync(resolve("scripts/fixtures/snapshot-v2.json"), "utf8")) as Snapshot;
let database: DatabaseSync, driver: DbDriver, bucket: R2BucketLike;
let objects: Map<string, { text: string; metadata: Record<string, string> }>;
beforeEach(() => {
  database = new DatabaseSync(":memory:");
  for (const file of readdirSync("apps/api/migrations").sort())
    database.exec(readFileSync(`apps/api/migrations/${file}`, "utf8"));
  const statement = (sql: string) => {
    const stmt = database.prepare(sql);
    stmt.setAllowBareNamedParameters(true);
    return stmt;
  };
  const bindings = (params: unknown[]) =>
    Object.fromEntries(params.map((p, i) => [String(i + 1), p as SQLInputValue]));
  driver = {
    async query<T>(sql: string, params: unknown[] = []) {
      return statement(sql).all(bindings(params)) as T[];
    },
    async queryFirst<T>(sql: string, params: unknown[] = []) {
      return (statement(sql).get(bindings(params)) as T) ?? null;
    },
    async execute(sql: string, params: unknown[] = []) {
      const result = statement(sql).run(bindings(params));
      return { changes: Number(result.changes), lastRowId: Number(result.lastInsertRowid) };
    },
    async batch(statements) {
      for (const s of statements) statement(s.sql).run(bindings(s.params ?? []));
    },
  };
  objects = new Map();
  bucket = {
    async get(key) {
      const object = objects.get(key);
      return object ? { text: async () => object.text, customMetadata: object.metadata } : null;
    },
    async put(key, value, options) {
      if (objects.has(key) && options?.onlyIf) return null;
      objects.set(key, { text: String(value), metadata: options?.customMetadata ?? {} });
      return {};
    },
    async delete(key) {
      objects.delete(key);
    },
  };
});
afterEach(() => database.close());
function app(email?: string) {
  const hono = new Hono<AppEnv>();
  hono.use("*", async (c, next) => {
    if (email) c.set("accessEmail", email);
    await next();
  });
  hono.route(
    "/snapshots",
    createApiSnapshotsRoute({ getBucket: () => bucket, getDriver: () => driver }),
  );
  return hono;
}

describe("immutable v2 snapshot service", () => {
  it("validates and stores self-contained v2, with account-scoped idempotent parallel uploads and receipts", async () => {
    const snapshot = fixture();
    expect(isValidSnapshotPayload(snapshot)).toBe(true);
    expect(await validateSnapshotContents(snapshot)).toBe(true);
    const results = await Promise.all([
      storeSnapshot(driver, bucket, "alice@example.com", snapshot),
      storeSnapshot(driver, bucket, "alice@example.com", snapshot),
    ]);
    expect(results[0]?.receipt).toEqual(results[1]?.receipt);
    expect(results.map((r) => r.created).sort()).toEqual([false, true]);
    expect(objects.size).toBe(1);
    await storeSnapshot(driver, bucket, "bob@example.com", snapshot);
    expect(objects.size).toBe(2);
    const changed = fixture();
    required(changed.collectors[0]?.files[0]).content = "different";
    await expect(storeSnapshot(driver, bucket, "alice@example.com", changed)).rejects.toThrow(
      "different content",
    );
    expect(JSON.parse(required(objects.get(`alice@example.com/${snapshot.id}.json`)).text)).toEqual(
      snapshot,
    );
    const response = await app("alice@example.com").request(`/snapshots/${snapshot.id}`);
    expect(response.status).toBe(200);
    expect(((await response.json()) as { receipt: unknown }).receipt).toEqual(results[0]?.receipt);
    const deletion = await app("alice@example.com").request(`/snapshots/${snapshot.id}`, {
      method: "DELETE",
    });
    expect(deletion.status).toBe(200);
    expect((await app("bob@example.com").request(`/snapshots/${snapshot.id}`)).status).toBe(200);
  });

  it("recovers an accepted R2 object after indexing fails, keeping receipt time and exact content", async () => {
    const snapshot = fixture();
    const original = driver.execute;
    driver.execute = async (sql, params) => {
      if (sql.includes("INSERT INTO snapshots")) throw new Error("index unavailable");
      return original(sql, params);
    };
    await expect(storeSnapshot(driver, bucket, "user@example.com", snapshot)).rejects.toThrow(
      "index",
    );
    const metadata = required(objects.values().next().value).metadata;
    driver.execute = original;
    const retried = await storeSnapshot(driver, bucket, "user@example.com", snapshot);
    expect(retried.receipt.receivedAt).toBe(metadata["receivedAt"]);
    expect(retried.receipt.sha256).toBe(await sha256(JSON.stringify(snapshot)));
    const repeat = await app("user@example.com").request("/snapshots", {
      method: "POST",
      body: JSON.stringify(snapshot),
    });
    expect(repeat.status).toBe(200);
    const mismatch = fixture();
    mismatch.id = "new-id";
    objects.set("user@example.com/new-id.json", { text: JSON.stringify(snapshot), metadata: {} });
    expect(
      (
        await app("user@example.com").request("/snapshots", {
          method: "POST",
          body: JSON.stringify(mismatch),
        })
      ).status,
    ).toBe(409);
  });

  it("returns devices by capture time, retains the latest complete snapshot and paginates equal receive timestamps", async () => {
    const snapshot = fixture();
    for (let i = 0; i < 4; i++) {
      const version = structuredClone(snapshot);
      version.id = `snapshot-${i}`;
      version.createdAt = `2026-09-${10 + i}T00:00:00.000Z`;
      required(version.workspace).coverage.complete = i < 2;
      // biome-ignore lint/performance/noAwaitInLoops: capture and upload order are intentionally distinct in this fixture
      await storeSnapshot(driver, bucket, "owner", version);
    }
    database.exec("UPDATE snapshots SET uploaded_at = 1000");
    const first = await listSnapshots(driver, "owner", {
      limit: 2,
      device: "fixture-stable-device",
    });
    const second = await listSnapshots(driver, "owner", {
      limit: 2,
      cursor: required(first.nextCursor),
      device: "fixture-stable-device",
    });
    expect(first.total).toBe(4);
    expect(second.total).toBe(4);
    expect([...first.rows, ...second.rows].map((r) => r.id)).toEqual([
      "snapshot-3",
      "snapshot-2",
      "snapshot-1",
      "snapshot-0",
    ]);
    const devices = await listDevices(driver, "owner");
    expect(devices).toHaveLength(1);
    expect(devices[0]?.id).toBe("snapshot-3");
    expect((devices[0] as unknown as { latest_complete_id: string }).latest_complete_id).toBe(
      "snapshot-1",
    );
    expect((await listSnapshots(driver, "owner", { search: "local" })).total).toBe(4);
    expect((await listSnapshots(driver, "owner", { search: "%' OR 1=1 --" })).rows).toHaveLength(0);
    expect((await app("owner").request("/snapshots/devices")).status).toBe(200);
    expect((await app().request("/snapshots/devices")).status).toBe(401);
    expect(
      (
        await app("owner").request(
          `/snapshots?device=fixture-stable-device&search=local&cursor=${encodeURIComponent(required(first.nextCursor))}`,
        )
      ).status,
    ).toBe(200);
    expect((await app("owner").request("/snapshots?cursor=broken")).status).toBe(400);
    expect((await app("owner").request("/snapshots?cursor=%5B0,0%5D")).status).toBe(400);
  });

  it("reports missing concurrent objects, corrupt storage and metadata failures without confirming acceptance", async () => {
    const snapshot = fixture();
    const get = bucket.get,
      put = bucket.put;
    bucket.put = async () => null;
    await expect(storeSnapshot(driver, bucket, "owner", snapshot)).rejects.toThrow("store");
    bucket.put = put;
    await storeSnapshot(driver, bucket, "owner", snapshot);
    required(objects.get(`owner/${snapshot.id}.json`)).text = JSON.stringify({ changed: true });
    expect((await app("owner").request(`/snapshots/${snapshot.id}`)).status).toBe(500);
    bucket.get = async () => {
      throw new Error("read failed");
    };
    await expect(storeSnapshot(driver, bucket, "owner", snapshot)).rejects.toThrow("store");
    bucket.get = get;
    const noIndex = { ...driver, queryFirst: async () => null };
    await expect(storeSnapshot(noIndex, bucket, "another-owner", snapshot)).rejects.toThrow(
      "index",
    );
  });

  it("chunks large search indexes within D1 parameter limits and searches long terms literally", async () => {
    const snapshot = fixture();
    snapshot.version = 1;
    delete snapshot.workspace;
    const collector = required(snapshot.collectors[0]);
    collector.files = [];
    const query = `rules_${"long-search-term-".repeat(5)}100%`;
    collector.lists = Array.from({ length: 2100 }, (_, index) => ({
      name: `${index}-${"a".repeat(1800)}${index === 2000 ? query : ""}`,
    }));
    snapshot.collectors = [collector];
    const batch = driver.batch;
    const lengths: number[] = [];
    driver.batch = async (statements) => {
      lengths.push(statements.length);
      expect(statements.every((statement) => (statement.params?.length ?? 0) <= 100)).toBe(true);
      return batch(statements);
    };
    await storeSnapshot(driver, bucket, "owner", snapshot);
    expect(lengths).toEqual([2]);
    expect(
      (await listSnapshots(driver, "owner", { search: query })).rows.map((row) => row.id),
    ).toEqual([snapshot.id]);
    expect(
      (await listSnapshots(driver, "owner", { search: query.replace("100%", "100_") })).total,
    ).toBe(0);
    expect((await listSnapshots(driver, "another-owner", { search: query })).total).toBe(0);
  });
});

describe("snapshot validation", () => {
  it.each([
    null,
    [],
    {},
    { version: 2 },
    { ...fixture(), id: "../escape" },
    { ...fixture(), createdAt: "not-a-date" },
    { ...fixture(), machine: [] },
    { ...fixture(), collectors: [null] },
  ])("rejects invalid top-level data: %j", (value) =>
    expect(isValidSnapshotPayload(value)).toBe(false),
  );
  it("rejects malformed roots, resources, duplicate paths, encoding errors, hashes and missing recovery metadata", async () => {
    const mutations: ((s: Snapshot) => void)[] = [
      (s) => {
        delete s.workspace;
      },
      (s) => {
        required(s.workspace).roots.push(required(s.workspace?.roots[0]));
      },
      (s) => {
        required(s.workspace?.resources[0]).rootId = "absent";
      },
      (s) => {
        required(s.collectors[0]?.files[0]).rootId = "absent";
      },
      (s) => {
        required(s.collectors[0]).files.push(required(s.collectors[0]?.files[0]));
      },
      (s) => {
        required(s.collectors[0]?.files[0]).relativePath = "../outside";
      },
      (s) => {
        required(s.collectors[0]?.files[0]).encoding = "base64";
        required(s.collectors[0]?.files[0]).content = "%%%";
      },
      (s) => {
        required(s.collectors[0]?.files[0]).sizeBytes++;
      },
      (s) => {
        required(s.collectors[0]?.files[0]).sha256 = "0".repeat(64);
      },
      (s) => {
        delete required(s.collectors[0]?.files[0]).sha256;
      },
      (s) => {
        delete required(s.collectors[0]?.files[0]).mode;
      },
      (s) => {
        delete required(s.collectors[0]?.files[0]).links;
      },
      (s) => {
        required(s.collectors[0]?.files[0]).kind = "symlink";
      },
    ];
    for (const change of mutations) {
      const snapshot = fixture();
      change(snapshot);
      // biome-ignore lint/performance/noAwaitInLoops: isolate each malformed payload and its validation
      expect(await validateSnapshotContents(snapshot)).toBe(false);
    }
    const valid = fixture();
    const file = required(valid.collectors[0]?.files[0]);
    file.encoding = "base64";
    file.content = btoa(file.content);
    expect(await validateSnapshotContents(valid)).toBe(true);
    expect(
      (
        await app("owner").request("/snapshots", {
          method: "POST",
          body: JSON.stringify({ ...valid, workspace: null }),
        })
      ).status,
    ).toBe(400);
  });

  it("accepts self-contained references and empty directories, rejecting inconsistent reference and coverage metadata", async () => {
    const snapshot = fixture();
    const files = required(snapshot.collectors[0]).files;
    const source = required(files.find((file) => file.rootId === "workflow"));
    const reference = required(files.find((file) => file.path.endsWith(".claude/CLAUDE.md")));
    expect(reference.content).toBe(source.content);
    reference.contentRef = required(source.sha256);
    reference.content = "";
    required(snapshot.workspace).coverage.bytes -= reference.sizeBytes;
    expect(await validateSnapshotContents(snapshot)).toBe(true);
    const mutations: ((file: typeof reference) => void)[] = [
      (file) => {
        file.contentRef = "0".repeat(64);
      },
      (file) => {
        file.sha256 = "0".repeat(64);
      },
      (file) => {
        file.encoding = "base64";
      },
      (file) => {
        file.sizeBytes++;
      },
      (file) => {
        file.content = "must be empty for a reference";
      },
    ];
    await Promise.all(
      mutations.map(async (mutate) => {
        const changed = structuredClone(snapshot);
        mutate(required(required(changed.collectors[0]).files.find((file) => file.contentRef)));
        expect(await validateSnapshotContents(changed)).toBe(false);
      }),
    );
    files.push({
      path: "/Users/fixture/workflow/empty",
      relativePath: "empty",
      rootId: "workflow",
      kind: "directory",
      mode: 0o750,
      encoding: "utf8",
      links: [],
      content: "",
      sizeBytes: 0,
    });
    expect(await validateSnapshotContents(snapshot)).toBe(true);
    required(snapshot.workspace).coverage.files++;
    expect(await validateSnapshotContents(snapshot)).toBe(false);
    required(snapshot.workspace).coverage.files--;
    required(snapshot.workspace).coverage.complete = true;
    required(snapshot.workspace).coverage.issues.push({
      rootId: "workflow",
      path: "/offline",
      status: "unstable",
      reason: "Changed during capture",
    });
    expect(await validateSnapshotContents(snapshot)).toBe(false);
  });
});
