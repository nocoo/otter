// Unit tests for createApiIconsRoute — auth, validation, R2 write path.

import { Hono } from "hono";
import { beforeEach, describe, expect, it } from "vitest";
import type { AppEnv } from "../../lib/app-env";
import type { R2BucketLike } from "../../lib/r2";
import { createApiIconsRoute } from "../../routes/api-icons";

function fakeBucket() {
  const puts: Array<{ key: string; value: unknown; options?: unknown }> = [];
  const bucket = {
    async get() {
      return null;
    },
    async put(key: string, value: unknown, options?: unknown) {
      puts.push({ key, value, options });
      return {};
    },
    async delete() {
      /* no-op */
    },
  } as unknown as R2BucketLike;
  return { bucket, puts };
}

function buildApp(opts: { bucket: R2BucketLike; email?: string | null; prefix?: string }) {
  const app = new Hono<AppEnv>();
  app.use("*", async (c, next) => {
    if (opts.email) c.set("accessEmail", opts.email);
    await next();
  });
  const routeOpts: {
    getBucket: () => R2BucketLike;
    getPrefix?: () => string;
  } = { getBucket: () => opts.bucket };
  if (opts.prefix) routeOpts.getPrefix = () => opts.prefix as string;
  app.route("/icons", createApiIconsRoute(routeOpts));
  return app;
}

const HASH = "abcdef012345";
// 1x1 transparent PNG
const TINY_PNG_BASE64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=";

describe("createApiIconsRoute", () => {
  let pair: ReturnType<typeof fakeBucket>;

  beforeEach(() => {
    pair = fakeBucket();
  });

  it("returns 401 without auth", async () => {
    const app = buildApp({ bucket: pair.bucket, email: null });
    const res = await app.request("/icons", {
      method: "POST",
      body: JSON.stringify({ icons: [{ hash: HASH, data: TINY_PNG_BASE64 }] }),
    });
    expect(res.status).toBe(401);
  });

  it("returns 200 and stored:0 for empty array", async () => {
    const app = buildApp({ bucket: pair.bucket, email: "alice@x" });
    const res = await app.request("/icons", {
      method: "POST",
      body: JSON.stringify({ icons: [] }),
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ stored: 0 });
    expect(pair.puts).toHaveLength(0);
  });

  it("stores each icon in R2 with the default prefix", async () => {
    const app = buildApp({ bucket: pair.bucket, email: "alice@x" });
    const res = await app.request("/icons", {
      method: "POST",
      body: JSON.stringify({
        icons: [
          { hash: HASH, data: TINY_PNG_BASE64 },
          { hash: "0123456789ab", data: TINY_PNG_BASE64 },
        ],
      }),
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ stored: 2 });
    expect(pair.puts.map((p) => p.key).sort()).toEqual([
      "apps/otter/0123456789ab.png",
      `apps/otter/${HASH}.png`,
    ]);
  });

  it("uses a custom prefix when provided", async () => {
    const app = buildApp({ bucket: pair.bucket, email: "alice@x", prefix: "custom/pfx" });
    const res = await app.request("/icons", {
      method: "POST",
      body: JSON.stringify({ icons: [{ hash: HASH, data: TINY_PNG_BASE64 }] }),
    });
    expect(res.status).toBe(200);
    expect(pair.puts[0]?.key).toBe(`custom/pfx/${HASH}.png`);
  });

  it("returns 400 on invalid JSON body", async () => {
    const app = buildApp({ bucket: pair.bucket, email: "alice@x" });
    const res = await app.request("/icons", { method: "POST", body: "not json" });
    expect(res.status).toBe(400);
  });

  it("returns 400 on invalid hash format", async () => {
    const app = buildApp({ bucket: pair.bucket, email: "alice@x" });
    const res = await app.request("/icons", {
      method: "POST",
      body: JSON.stringify({ icons: [{ hash: "TOOLONG12345678", data: TINY_PNG_BASE64 }] }),
    });
    expect(res.status).toBe(400);
  });

  it("returns 400 when an icon exceeds the size limit", async () => {
    const app = buildApp({ bucket: pair.bucket, email: "alice@x" });
    const huge = "A".repeat(150_001);
    const res = await app.request("/icons", {
      method: "POST",
      body: JSON.stringify({ icons: [{ hash: HASH, data: huge }] }),
    });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toContain("size limit");
  });

  it("returns 400 when more than 500 icons are sent", async () => {
    const app = buildApp({ bucket: pair.bucket, email: "alice@x" });
    const icons = Array.from({ length: 501 }, (_, i) => ({
      hash: i.toString(16).padStart(12, "0"),
      data: TINY_PNG_BASE64,
    }));
    const res = await app.request("/icons", {
      method: "POST",
      body: JSON.stringify({ icons }),
    });
    expect(res.status).toBe(400);
  });

  it("returns 207 when some icons fail to store", async () => {
    let call = 0;
    const brokenBucket = {
      async get() {
        return null;
      },
      async put() {
        call++;
        if (call === 2) throw new Error("R2 down for hash #2");
      },
      async delete() {
        /* no-op */
      },
    } as unknown as R2BucketLike;
    const app = buildApp({ bucket: brokenBucket, email: "alice@x" });
    const res = await app.request("/icons", {
      method: "POST",
      body: JSON.stringify({
        icons: [
          { hash: HASH, data: TINY_PNG_BASE64 },
          { hash: "0123456789ab", data: TINY_PNG_BASE64 },
          { hash: "fedcba987654", data: TINY_PNG_BASE64 },
        ],
      }),
    });
    expect(res.status).toBe(207);
    const body = (await res.json()) as { stored: number; errors: string[] };
    expect(body.stored).toBe(2);
    expect(body.errors).toEqual(["0123456789ab"]);
  });
});
