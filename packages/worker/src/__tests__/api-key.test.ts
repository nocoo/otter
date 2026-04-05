import { createExecutionContext, env, waitOnExecutionContext } from "cloudflare:test";
import { Hono } from "hono";
import { describe, expect, it } from "vitest";
import { apiKeyMiddleware } from "../middleware/api-key.js";
import type { Env, Variables } from "../types.js";
import "../test-env.d.js";

interface UserIdResponse {
  userId: string;
}

interface ErrorResponse {
  error: string;
}

describe("apiKeyMiddleware", () => {
  function createApp() {
    const app = new Hono<{ Bindings: Env; Variables: Variables }>();
    app.use("/v1/*", apiKeyMiddleware);
    app.get("/v1/test", (c) => c.json({ userId: c.get("userId") }));
    return app;
  }

  it("allows request with valid API key and user ID", async () => {
    const app = createApp();

    const req = new Request("http://localhost/v1/test", {
      headers: {
        "X-API-Key": "test-api-key",
        "X-User-ID": "user-123",
      },
    });
    const ctx = createExecutionContext();
    const res = await app.fetch(req, env, ctx);
    await waitOnExecutionContext(ctx);

    expect(res.status).toBe(200);
    const body = (await res.json()) as UserIdResponse;
    expect(body.userId).toBe("user-123");
  });

  it("rejects request with invalid API key", async () => {
    const app = createApp();

    const req = new Request("http://localhost/v1/test", {
      headers: {
        "X-API-Key": "wrong-key",
        "X-User-ID": "user-123",
      },
    });
    const ctx = createExecutionContext();
    const res = await app.fetch(req, env, ctx);
    await waitOnExecutionContext(ctx);

    expect(res.status).toBe(401);
    const body = (await res.json()) as ErrorResponse;
    expect(body.error).toBe("Unauthorized");
  });

  it("rejects request without API key", async () => {
    const app = createApp();

    const req = new Request("http://localhost/v1/test", {
      headers: {
        "X-User-ID": "user-123",
      },
    });
    const ctx = createExecutionContext();
    const res = await app.fetch(req, env, ctx);
    await waitOnExecutionContext(ctx);

    expect(res.status).toBe(401);
  });

  it("rejects request without user ID", async () => {
    const app = createApp();

    const req = new Request("http://localhost/v1/test", {
      headers: {
        "X-API-Key": "test-api-key",
      },
    });
    const ctx = createExecutionContext();
    const res = await app.fetch(req, env, ctx);
    await waitOnExecutionContext(ctx);

    expect(res.status).toBe(400);
    const body = (await res.json()) as ErrorResponse;
    expect(body.error).toBe("Missing X-User-ID");
  });
});
