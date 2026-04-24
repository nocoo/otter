// createApp() integration tests — verify that a single factory wires both
// the legacy /v1/* surface and the new /api/* surface based on options.

import { Hono } from "hono";
import { describe, expect, it } from "vitest";
import { createApp } from "../../app";
import type { DbDriver } from "../../lib/db/driver";
import type { R2BucketLike } from "../../lib/r2";
import { createMockDriver } from "./_mock-driver";

function fakeBucket() {
  const store = new Map<string, string>();
  const bucket: R2BucketLike = {
    async get(key: string) {
      const v = store.get(key);
      if (v === undefined) return null;
      return {
        async text() {
          return v;
        },
      };
    },
    async put(key: string, value: string | ArrayBuffer | ReadableStream) {
      store.set(key, value as string);
      return {};
    },
    async delete(key: string) {
      store.delete(key);
    },
  };
  return { bucket, store };
}

describe("createApp() — legacy mode", () => {
  it("mounts /v1/live without a driver", async () => {
    const app = createApp();
    const r = await app.fetch(new Request("https://x/v1/live"));
    // /v1/live touches the http D1 client and will 503 without env, but the
    // route MUST be mounted (i.e. no 404).
    expect(r.status).not.toBe(404);
  });

  it("does NOT mount /api/* when no driver is supplied", async () => {
    const app = createApp();
    const r = await app.fetch(new Request("https://x/api/live"));
    expect(r.status).toBe(404);
  });
});

describe("createApp({ driver }) — new /api/* mode", () => {
  function build(driver: DbDriver, withBucket = true) {
    const { bucket } = fakeBucket();
    return createApp({
      basePath: "/api",
      driver,
      ...(withBucket ? { bucket } : {}),
      auth: { access: false, bearer: false },
    });
  }

  it("mounts /api/live", async () => {
    const { driver } = createMockDriver();
    const app = build(driver);
    const r = await app.fetch(new Request("https://x/api/live"));
    expect(r.status).toBe(200);
    expect(await r.json()).toEqual({ ok: true, version: "2.0.0" });
  });

  it("/api/me returns unauthenticated when no accessEmail set", async () => {
    const { driver } = createMockDriver();
    const app = build(driver);
    const r = await app.fetch(new Request("https://x/api/me"));
    expect(r.status).toBe(200);
    const body = (await r.json()) as { authenticated: boolean };
    expect(body.authenticated).toBe(false);
  });

  it("mounts /api/auth/cli (returns 400 without callback)", async () => {
    const { driver } = createMockDriver();
    const app = build(driver);
    const r = await app.fetch(new Request("https://x/api/auth/cli"));
    expect(r.status).toBe(400);
  });

  it("mounts /api/snapshots (401 without auth)", async () => {
    const { driver } = createMockDriver();
    const app = build(driver);
    const r = await app.fetch(new Request("https://x/api/snapshots"));
    expect(r.status).toBe(401);
  });

  it("mounts /api/webhooks (401 without auth)", async () => {
    const { driver } = createMockDriver();
    const app = build(driver);
    const r = await app.fetch(new Request("https://x/api/webhooks"));
    expect(r.status).toBe(401);
  });

  it("does NOT mount /api/snapshots when no bucket is supplied", async () => {
    const { driver } = createMockDriver();
    const app = build(driver, false);
    const r = await app.fetch(new Request("https://x/api/snapshots"));
    expect(r.status).toBe(404);
  });

  it("respects custom basePath", async () => {
    const { driver } = createMockDriver();
    const { bucket } = fakeBucket();
    const app = createApp({
      basePath: "/custom",
      driver,
      bucket,
      auth: { access: false, bearer: false },
    });
    const r = await app.fetch(new Request("https://x/custom/live"));
    expect(r.status).toBe(200);
  });

  it("apiKeyAuth on by default — protects routes", async () => {
    const { driver } = createMockDriver();
    const { bucket } = fakeBucket();
    const app = createApp({ basePath: "/api", driver, bucket });
    // No Bearer header → middleware should respond 401 from /api/snapshots.
    // (apiKeyAuth has a localhost dev bypass; use a non-loopback request URL.)
    const r = await app.fetch(
      new Request("https://x/api/snapshots", {
        headers: { "X-Forwarded-For": "1.2.3.4" },
      }),
    );
    expect(r.status).toBe(401);
  });

  it("driver is injected into context so Bearer auth can run", async () => {
    // Build an app with bearer auth on; expect 401 without token, not 500.
    const { driver } = createMockDriver();
    const { bucket } = fakeBucket();
    const app = createApp({ basePath: "/api", driver, bucket, auth: { bearer: true } });
    const r = await app.fetch(
      new Request("https://x/api/snapshots", {
        headers: { "X-Forwarded-For": "1.2.3.4" },
      }),
    );
    expect(r.status).toBe(401);
  });

  it("legacy /v1/* still routes alongside /api/*", async () => {
    const { driver } = createMockDriver();
    const { bucket } = fakeBucket();
    const app = createApp({ basePath: "/api", driver, bucket });
    const live = await app.fetch(new Request("https://x/api/live"));
    expect(live.status).toBe(200);
    const v1 = await app.fetch(new Request("https://x/v1/live"));
    expect(v1.status).not.toBe(404);
  });
});

describe("createApp — type sanity", () => {
  it("returns a Hono instance", () => {
    expect(createApp()).toBeInstanceOf(Hono);
  });
});
