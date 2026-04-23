// Unit tests for createApiSnapshotsRoute / createApiWebhooksRoute.
// Uses an in-memory DbDriver and a fake R2BucketLike; no miniflare D1 needed.

import { Hono } from "hono";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AppEnv } from "../../lib/app-env";
import type { DbDriver } from "../../lib/db/driver";
import type { R2BucketLike } from "../../lib/r2";
import { createApiSnapshotsRoute } from "../../routes/api-snapshots";
import { createApiWebhooksRoute } from "../../routes/api-webhooks";

interface SnapRow {
  id: string;
  user_id: string;
  hostname: string | null;
  platform: string | null;
  arch: string | null;
  username: string | null;
  collector_count: number;
  file_count: number;
  list_count: number;
  size_bytes: number;
  snapshot_at: number;
  uploaded_at: number;
}

interface WebhookRow {
  id: string;
  user_id: string;
  token: string;
  label: string;
  is_active: number;
  created_at: number;
}

function makeSnap(id: string, user: string): SnapRow {
  return {
    id,
    user_id: user,
    hostname: "host",
    platform: "darwin",
    arch: "arm64",
    username: "u",
    collector_count: 1,
    file_count: 2,
    list_count: 3,
    size_bytes: 100,
    snapshot_at: 1700000000000,
    uploaded_at: 1700000001000,
  };
}

function memoryDriver(state: { snaps: SnapRow[]; webhooks: WebhookRow[] }): DbDriver {
  return {
    async query<T>(sql: string, params: unknown[] = []): Promise<T[]> {
      if (sql.includes("FROM snapshots") && sql.includes("WHERE user_id")) {
        const userId = params[0] as string;
        return state.snaps
          .filter((s) => s.user_id === userId)
          .sort((a, b) => b.uploaded_at - a.uploaded_at) as unknown as T[];
      }
      if (sql.includes("FROM webhooks") && sql.includes("WHERE user_id")) {
        const userId = params[0] as string;
        return state.webhooks.filter((w) => w.user_id === userId) as unknown as T[];
      }
      return [];
    },
    async queryFirst<T>(sql: string, params: unknown[] = []): Promise<T | null> {
      if (sql.includes("COUNT(*)") && sql.includes("snapshots")) {
        const userId = params[0] as string;
        const total = state.snaps.filter((s) => s.user_id === userId).length;
        return { total } as unknown as T;
      }
      if (sql.includes("FROM snapshots WHERE id = ?1 AND user_id = ?2")) {
        const [id, user] = params as [string, string];
        const found = state.snaps.find((s) => s.id === id && s.user_id === user) ?? null;
        return found as unknown as T | null;
      }
      if (sql.includes("FROM webhooks WHERE id = ?1 AND user_id = ?2")) {
        const [id, user] = params as [string, string];
        const found = state.webhooks.find((w) => w.id === id && w.user_id === user) ?? null;
        return found as unknown as T | null;
      }
      if (sql.includes("FROM webhooks WHERE id = ?1") && !sql.includes("user_id = ?2")) {
        const id = params[0] as string;
        const found = state.webhooks.find((w) => w.id === id) ?? null;
        if (!found) return null;
        return { user_id: found.user_id } as unknown as T;
      }
      return null;
    },
    async execute(sql: string, params: unknown[] = []) {
      if (sql.startsWith("DELETE FROM snapshots")) {
        const id = params[0] as string;
        const before = state.snaps.length;
        state.snaps = state.snaps.filter((s) => s.id !== id);
        return { changes: before - state.snaps.length, lastRowId: null };
      }
      if (sql.startsWith("DELETE FROM webhooks")) {
        const id = params[0] as string;
        const before = state.webhooks.length;
        state.webhooks = state.webhooks.filter((w) => w.id !== id);
        return { changes: before - state.webhooks.length, lastRowId: null };
      }
      if (sql.startsWith("INSERT INTO webhooks")) {
        const [id, user_id, token, label, is_active, created_at] = params as [
          string,
          string,
          string,
          string,
          number,
          number,
        ];
        state.webhooks.push({ id, user_id, token, label, is_active, created_at });
        return { changes: 1, lastRowId: null };
      }
      if (sql.startsWith("UPDATE webhooks")) {
        return { changes: 1, lastRowId: null };
      }
      return { changes: 0, lastRowId: null };
    },
    async batch() {
      // not used by these routes
    },
  };
}

function fakeBucket(): { bucket: R2BucketLike; store: Map<string, string> } {
  const store = new Map<string, string>();
  const bucket = {
    async get(key: string) {
      const v = store.get(key);
      if (v === undefined) return null;
      return {
        async text() {
          return v;
        },
      };
    },
    async put(key: string, value: string) {
      store.set(key, value);
      return {};
    },
    async delete(key: string) {
      store.delete(key);
    },
  } as unknown as R2BucketLike;
  return { bucket, store };
}

function buildApp(opts: {
  driver: DbDriver;
  bucket: R2BucketLike;
  email?: string | null;
  mountWebhooks?: boolean;
}) {
  const app = new Hono<AppEnv>();
  app.use("*", async (c, next) => {
    if (opts.email) c.set("accessEmail", opts.email);
    await next();
  });
  app.route(
    "/snapshots",
    createApiSnapshotsRoute({ getDriver: () => opts.driver, getBucket: () => opts.bucket }),
  );
  if (opts.mountWebhooks ?? true) {
    app.route("/webhooks", createApiWebhooksRoute({ getDriver: () => opts.driver }));
  }
  return app;
}

describe("createApiSnapshotsRoute", () => {
  let state: { snaps: SnapRow[]; webhooks: WebhookRow[] };
  let bucketPair: ReturnType<typeof fakeBucket>;

  beforeEach(() => {
    state = { snaps: [makeSnap("s1", "alice@x"), makeSnap("s2", "bob@x")], webhooks: [] };
    bucketPair = fakeBucket();
    bucketPair.store.set("alice@x/s1.json", JSON.stringify({ hello: "world" }));
  });

  it("returns 401 without auth", async () => {
    const app = buildApp({ driver: memoryDriver(state), bucket: bucketPair.bucket, email: null });
    const res = await app.request("/snapshots");
    expect(res.status).toBe(401);
  });

  it("lists only the caller's snapshots", async () => {
    const app = buildApp({
      driver: memoryDriver(state),
      bucket: bucketPair.bucket,
      email: "alice@x",
    });
    const res = await app.request("/snapshots");
    expect(res.status).toBe(200);
    const body = (await res.json()) as { snapshots: { id: string }[]; total: number };
    expect(body.snapshots.map((s) => s.id)).toEqual(["s1"]);
    expect(body.total).toBe(1);
  });

  it("returns snapshot detail with R2 body", async () => {
    const app = buildApp({
      driver: memoryDriver(state),
      bucket: bucketPair.bucket,
      email: "alice@x",
    });
    const res = await app.request("/snapshots/s1");
    expect(res.status).toBe(200);
    const body = (await res.json()) as { snapshot: { id: string }; data: unknown };
    expect(body.snapshot.id).toBe("s1");
    expect(body.data).toEqual({ hello: "world" });
  });

  it("returns 404 when snapshot meta missing", async () => {
    const app = buildApp({
      driver: memoryDriver(state),
      bucket: bucketPair.bucket,
      email: "alice@x",
    });
    const res = await app.request("/snapshots/nope");
    expect(res.status).toBe(404);
  });

  it("returns 404 when blob missing in R2", async () => {
    bucketPair.store.delete("alice@x/s1.json");
    const app = buildApp({
      driver: memoryDriver(state),
      bucket: bucketPair.bucket,
      email: "alice@x",
    });
    const res = await app.request("/snapshots/s1");
    expect(res.status).toBe(404);
  });

  it("delete removes meta and blob", async () => {
    const app = buildApp({
      driver: memoryDriver(state),
      bucket: bucketPair.bucket,
      email: "alice@x",
    });
    const res = await app.request("/snapshots/s1", { method: "DELETE" });
    expect(res.status).toBe(200);
    expect(state.snaps.find((s) => s.id === "s1")).toBeUndefined();
    expect(bucketPair.store.has("alice@x/s1.json")).toBe(false);
  });

  it("delete returns 404 when not owned", async () => {
    const app = buildApp({
      driver: memoryDriver(state),
      bucket: bucketPair.bucket,
      email: "alice@x",
    });
    const res = await app.request("/snapshots/s2", { method: "DELETE" });
    expect(res.status).toBe(404);
  });
});

describe("createApiWebhooksRoute", () => {
  let state: { snaps: SnapRow[]; webhooks: WebhookRow[] };

  beforeEach(() => {
    state = {
      snaps: [],
      webhooks: [
        {
          id: "w1",
          user_id: "alice@x",
          token: "tok",
          label: "default",
          is_active: 1,
          created_at: 0,
        },
      ],
    };
  });

  it("returns 401 without auth", async () => {
    const app = buildApp({
      driver: memoryDriver(state),
      bucket: fakeBucket().bucket,
      email: null,
    });
    const res = await app.request("/webhooks");
    expect(res.status).toBe(401);
  });

  it("lists only caller's webhooks", async () => {
    const app = buildApp({
      driver: memoryDriver(state),
      bucket: fakeBucket().bucket,
      email: "alice@x",
    });
    const res = await app.request("/webhooks");
    const body = (await res.json()) as { webhooks: { id: string }[] };
    expect(body.webhooks.map((w) => w.id)).toEqual(["w1"]);
  });

  it("creates a webhook with default label", async () => {
    const app = buildApp({
      driver: memoryDriver(state),
      bucket: fakeBucket().bucket,
      email: "alice@x",
    });
    const res = await app.request("/webhooks", { method: "POST", body: "{}" });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { webhook: { label: string; token: string } };
    expect(body.webhook.label).toBe("default");
    expect(body.webhook.token).toBeTruthy();
  });

  it("get :id returns 404 when other user", async () => {
    const app = buildApp({
      driver: memoryDriver(state),
      bucket: fakeBucket().bucket,
      email: "bob@x",
    });
    const res = await app.request("/webhooks/w1");
    expect(res.status).toBe(404);
  });

  it("patch :id updates owner's webhook", async () => {
    const updateSpy = vi.spyOn(state.webhooks, "find");
    const app = buildApp({
      driver: memoryDriver(state),
      bucket: fakeBucket().bucket,
      email: "alice@x",
    });
    const res = await app.request("/webhooks/w1", {
      method: "PATCH",
      body: JSON.stringify({ label: "renamed" }),
    });
    expect(res.status).toBe(200);
    updateSpy.mockRestore();
  });

  it("patch :id returns 404 when not owner", async () => {
    const app = buildApp({
      driver: memoryDriver(state),
      bucket: fakeBucket().bucket,
      email: "bob@x",
    });
    const res = await app.request("/webhooks/w1", {
      method: "PATCH",
      body: JSON.stringify({ label: "x" }),
    });
    expect(res.status).toBe(404);
  });

  it("delete :id removes owner's webhook", async () => {
    const app = buildApp({
      driver: memoryDriver(state),
      bucket: fakeBucket().bucket,
      email: "alice@x",
    });
    const res = await app.request("/webhooks/w1", { method: "DELETE" });
    expect(res.status).toBe(200);
    expect(state.webhooks.find((w) => w.id === "w1")).toBeUndefined();
  });

  it("delete :id returns 404 when not owner", async () => {
    const app = buildApp({
      driver: memoryDriver(state),
      bucket: fakeBucket().bucket,
      email: "bob@x",
    });
    const res = await app.request("/webhooks/w1", { method: "DELETE" });
    expect(res.status).toBe(404);
  });
});
