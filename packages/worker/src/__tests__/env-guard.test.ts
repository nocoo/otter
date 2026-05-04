import { createExecutionContext, env, waitOnExecutionContext } from "cloudflare:test";
import { Hono } from "hono";
import { describe, expect, it } from "vitest";
import { envGuardMiddleware } from "../middleware/env-guard.js";
import type { Env, Variables } from "../types.js";
import "../test-env.d.js";

interface ErrorResponse {
  error: string;
}

describe("envGuardMiddleware", () => {
  it("allows test env with *-test resources", async () => {
    const app = new Hono<{ Bindings: Env; Variables: Variables }>();
    app.use("*", envGuardMiddleware);
    app.get("/", (c) => c.json({ ok: true }));

    const testEnv = {
      ...env,
      ENVIRONMENT: "test" as const,
      D1_DATABASE_NAME: "otter-db-test",
      R2_BUCKET_NAME: "otter-snapshots-test",
    };

    const req = new Request("http://localhost/");
    const ctx = createExecutionContext();
    const res = await app.fetch(req, testEnv, ctx);
    await waitOnExecutionContext(ctx);

    expect(res.status).toBe(200);
  });

  it("rejects test env with non-test D1", async () => {
    const app = new Hono<{ Bindings: Env; Variables: Variables }>();
    app.use("*", envGuardMiddleware);
    app.get("/", (c) => c.json({ ok: true }));

    const testEnv = {
      ...env,
      ENVIRONMENT: "test" as const,
      D1_DATABASE_NAME: "otter-db", // Missing -test suffix
      R2_BUCKET_NAME: "otter-snapshots-test",
    };

    const req = new Request("http://localhost/");
    const ctx = createExecutionContext();
    const res = await app.fetch(req, testEnv, ctx);
    await waitOnExecutionContext(ctx);

    expect(res.status).toBe(500);
    const body = (await res.json()) as ErrorResponse;
    expect(body.error).toContain("D1");
  });

  it("rejects test env with non-test R2", async () => {
    const app = new Hono<{ Bindings: Env; Variables: Variables }>();
    app.use("*", envGuardMiddleware);
    app.get("/", (c) => c.json({ ok: true }));

    const testEnv = {
      ...env,
      ENVIRONMENT: "test" as const,
      D1_DATABASE_NAME: "otter-db-test",
      R2_BUCKET_NAME: "otter-snapshots", // Missing -test suffix
    };

    const req = new Request("http://localhost/");
    const ctx = createExecutionContext();
    const res = await app.fetch(req, testEnv, ctx);
    await waitOnExecutionContext(ctx);

    expect(res.status).toBe(500);
    const body = (await res.json()) as ErrorResponse;
    expect(body.error).toContain("R2");
  });

  it("rejects production env with test resources", async () => {
    const app = new Hono<{ Bindings: Env; Variables: Variables }>();
    app.use("*", envGuardMiddleware);
    app.get("/", (c) => c.json({ ok: true }));

    const prodEnv = {
      ...env,
      ENVIRONMENT: "production" as const,
      D1_DATABASE_NAME: "otter-db-test", // Should not have -test in prod
      R2_BUCKET_NAME: "otter-snapshots",
    };

    const req = new Request("http://localhost/");
    const ctx = createExecutionContext();
    const res = await app.fetch(req, prodEnv, ctx);
    await waitOnExecutionContext(ctx);

    expect(res.status).toBe(500);
    const body = (await res.json()) as ErrorResponse;
    expect(body.error).toContain("test resource in prod");
  });

  it("allows production env with production resources", async () => {
    const app = new Hono<{ Bindings: Env; Variables: Variables }>();
    app.use("*", envGuardMiddleware);
    app.get("/", (c) => c.json({ ok: true }));

    const prodEnv = {
      ...env,
      ENVIRONMENT: "production" as const,
      D1_DATABASE_NAME: "otter-db",
      R2_BUCKET_NAME: "otter-snapshots",
    };

    const req = new Request("http://localhost/");
    const ctx = createExecutionContext();
    const res = await app.fetch(req, prodEnv, ctx);
    await waitOnExecutionContext(ctx);

    expect(res.status).toBe(200);
  });

  it("skips guard when E2E_SKIP_AUTH=true in non-production", async () => {
    const app = new Hono<{ Bindings: Env; Variables: Variables }>();
    app.use("*", envGuardMiddleware);
    app.get("/", (c) => c.json({ ok: true }));

    const testEnv = {
      ...env,
      ENVIRONMENT: "test" as const,
      D1_DATABASE_NAME: "otter-db", // Non-test name — would fail without E2E bypass
      R2_BUCKET_NAME: "otter-snapshots",
      E2E_SKIP_AUTH: "true",
    };

    const req = new Request("http://localhost/");
    const ctx = createExecutionContext();
    const res = await app.fetch(req, testEnv, ctx);
    await waitOnExecutionContext(ctx);

    expect(res.status).toBe(200);
  });

  it("E2E_SKIP_AUTH does NOT skip guard in production (still rejects test resources)", async () => {
    const app = new Hono<{ Bindings: Env; Variables: Variables }>();
    app.use("*", envGuardMiddleware);
    app.get("/", (c) => c.json({ ok: true }));

    const prodEnv = {
      ...env,
      ENVIRONMENT: "production" as const,
      D1_DATABASE_NAME: "otter-db-test", // Test resource in prod
      R2_BUCKET_NAME: "otter-snapshots",
      E2E_SKIP_AUTH: "true",
    };

    const req = new Request("http://localhost/");
    const ctx = createExecutionContext();
    const res = await app.fetch(req, prodEnv, ctx);
    await waitOnExecutionContext(ctx);

    expect(res.status).toBe(500);
    const body = (await res.json()) as ErrorResponse;
    expect(body.error).toContain("test resource in prod");
  });
});
