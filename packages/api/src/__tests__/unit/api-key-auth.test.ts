import { Hono } from "hono";
import { describe, expect, it } from "vitest";
import { createApiToken } from "../../lib/api-token-repo";
import type { AppEnv } from "../../lib/app-env";
import type { DbDriver } from "../../lib/db/driver";
import { createApiKeyAuth } from "../../middleware/api-key-auth";
import { createMockDriver } from "./_mock-driver";

function makeApp(driver: DbDriver) {
  const app = new Hono<AppEnv>();
  const mw = createApiKeyAuth({ getDriver: () => driver });
  app.use("*", mw);
  app.get("/api/live", (c) => c.text("live"));
  app.get("/api/x", (c) =>
    c.json({ email: c.get("accessEmail") ?? null, auth: c.get("accessAuthenticated") ?? false }),
  );
  return app;
}

describe("apiKeyAuth", () => {
  it("passes through /api/live without auth", async () => {
    const { driver } = createMockDriver();
    const app = makeApp(driver);
    const r = await app.fetch(new Request("https://prod/api/live"));
    expect(r.status).toBe(200);
  });

  it("dev-bypasses on localhost without bearer", async () => {
    const { driver } = createMockDriver();
    const app = makeApp(driver);
    const r = await app.fetch(
      new Request("http://localhost/api/x", { headers: { host: "localhost" } }),
    );
    expect(r.status).toBe(200);
  });

  it("passes through if accessAuthenticated already set", async () => {
    const { driver } = createMockDriver();
    const app = new Hono<AppEnv>();
    app.use("*", async (c, next) => {
      c.set("accessAuthenticated", true);
      await next();
    });
    app.use("*", createApiKeyAuth({ getDriver: () => driver }));
    app.get("/api/x", (c) => c.text("ok"));
    const r = await app.fetch(new Request("https://prod/api/x", { headers: { host: "prod" } }));
    expect(r.status).toBe(200);
  });

  it("returns 401 when no Authorization header on edge", async () => {
    const { driver } = createMockDriver();
    const app = makeApp(driver);
    const r = await app.fetch(new Request("https://prod/api/x", { headers: { host: "prod" } }));
    expect(r.status).toBe(401);
  });

  it("returns 401 when Authorization is malformed", async () => {
    const { driver } = createMockDriver();
    const app = makeApp(driver);
    const r = await app.fetch(
      new Request("https://prod/api/x", {
        headers: { host: "prod", Authorization: "Token xx" },
      }),
    );
    expect(r.status).toBe(401);
  });

  it("returns 403 when Bearer token not found", async () => {
    const { driver } = createMockDriver();
    const app = makeApp(driver);
    const r = await app.fetch(
      new Request("https://prod/api/x", {
        headers: { host: "prod", Authorization: "Bearer notreal" },
      }),
    );
    expect(r.status).toBe(403);
  });

  it("authenticates valid Bearer token", async () => {
    const { driver: createDriver } = createMockDriver();
    const created = await createApiToken(createDriver, {
      email: "u@example.com",
      id: "tok-1",
      now: 100,
    });

    const insert = (createDriver as DbDriver) && undefined;
    void insert;

    // Build a verify driver that returns the row matching the same hash.
    const { driver: verifyDriver } = createMockDriver({
      responses: [
        {
          match: "FROM api_tokens",
          rows: [{ id: "tok-1", email: "u@example.com" }],
        },
      ],
    });
    const app = makeApp(verifyDriver);
    const r = await app.fetch(
      new Request("https://prod/api/x", {
        headers: { host: "prod", Authorization: `Bearer ${created.token}` },
      }),
    );
    expect(r.status).toBe(200);
    const json = (await r.json()) as { email: string; auth: boolean };
    expect(json).toEqual({ email: "u@example.com", auth: true });
  });

  it("verifies bearer even on localhost (so accessEmail populates)", async () => {
    const { driver } = createMockDriver({
      responses: [{ match: "FROM api_tokens", rows: [{ id: "t", email: "cli@x" }] }],
    });
    const app = makeApp(driver);
    const r = await app.fetch(
      new Request("http://localhost/api/x", {
        headers: { host: "localhost", Authorization: "Bearer otk_xx" },
      }),
    );
    expect(r.status).toBe(200);
    const json = (await r.json()) as { email: string };
    expect(json.email).toBe("cli@x");
  });
});
