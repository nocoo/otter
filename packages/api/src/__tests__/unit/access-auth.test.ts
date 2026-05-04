import { Hono } from "hono";
import { beforeEach, describe, expect, it, vi } from "vitest";

const verifyMock = vi.fn<(jwt: string, jwks: unknown, opts: unknown) => Promise<unknown>>();
const createJwksMock = vi.fn<(url: URL) => string>(() => "fake-jwks");

vi.mock("jose", () => ({
  createRemoteJWKSet: (url: URL) => createJwksMock(url),
  jwtVerify: (jwt: string, jwks: unknown, opts: unknown) => verifyMock(jwt, jwks, opts),
}));

import type { AppEnv } from "../../lib/app-env";
import { accessAuth } from "../../middleware/access-auth";

function makeApp(env?: Record<string, string>) {
  const app = new Hono<AppEnv>();
  app.use("*", accessAuth);
  app.get("/api/live", (c) => c.text("live"));
  app.get("/api/me", (c) =>
    c.json({
      auth: c.get("accessAuthenticated") ?? false,
      email: c.get("accessEmail") ?? null,
    }),
  );
  return {
    fetch: (req: Request) => app.fetch(req, env ?? {}),
  };
}

describe("accessAuth", () => {
  beforeEach(() => {
    verifyMock.mockReset();
    createJwksMock.mockClear();
  });

  it("passes through public /api/live without auth", async () => {
    const app = makeApp();
    const r = await app.fetch(new Request("https://prod.example.com/api/live"));
    expect(r.status).toBe(200);
  });

  it("dev-bypasses on localhost without bearer", async () => {
    const app = makeApp();
    const r = await app.fetch(
      new Request("http://localhost:7020/api/me", { headers: { host: "localhost:7020" } }),
    );
    const json = (await r.json()) as { auth: boolean; email: string };
    expect(json.auth).toBe(true);
    expect(json.email).toBe("dev@localhost");
  });

  it("on localhost WITH bearer, doesn't auto-auth (lets apiKeyAuth handle)", async () => {
    const app = makeApp();
    const r = await app.fetch(
      new Request("http://localhost/api/me", {
        headers: { host: "localhost", Authorization: "Bearer xx" },
      }),
    );
    const json = (await r.json()) as { auth: boolean };
    expect(json.auth).toBe(false);
  });

  it("falls through when env vars missing", async () => {
    const app = makeApp();
    const r = await app.fetch(
      new Request("https://prod.example.com/api/me", {
        headers: { host: "prod.example.com" },
      }),
    );
    const json = (await r.json()) as { auth: boolean };
    expect(json.auth).toBe(false);
  });

  it("verifies JWT and sets email on success", async () => {
    verifyMock.mockResolvedValueOnce({ payload: { email: "u@example.com" } });
    const app = makeApp({
      CF_ACCESS_TEAM_DOMAIN: "team.cloudflareaccess.com",
      CF_ACCESS_AUD: "aud-123",
    });
    const r = await app.fetch(
      new Request("https://prod.example.com/api/me", {
        headers: {
          host: "prod.example.com",
          "Cf-Access-Jwt-Assertion": "jwt-token",
        },
      }),
    );
    const json = (await r.json()) as { auth: boolean; email: string };
    expect(json.auth).toBe(true);
    expect(json.email).toBe("u@example.com");
    expect(verifyMock).toHaveBeenCalledWith("jwt-token", "fake-jwks", {
      issuer: "https://team.cloudflareaccess.com",
      audience: "aud-123",
    });
  });

  it("falls through when JWT verification throws", async () => {
    verifyMock.mockRejectedValueOnce(new Error("bad sig"));
    const app = makeApp({
      CF_ACCESS_TEAM_DOMAIN: "team.cloudflareaccess.com",
      CF_ACCESS_AUD: "aud-123",
    });
    const r = await app.fetch(
      new Request("https://prod.example.com/api/me", {
        headers: { host: "prod.example.com", "Cf-Access-Jwt-Assertion": "bad" },
      }),
    );
    const json = (await r.json()) as { auth: boolean };
    expect(json.auth).toBe(false);
  });

  it("falls through when only CF_ACCESS_TEAM_DOMAIN set (missing AUD)", async () => {
    const app = makeApp({ CF_ACCESS_TEAM_DOMAIN: "team.cloudflareaccess.com" });
    const r = await app.fetch(
      new Request("https://prod.example.com/api/me", {
        headers: { host: "prod.example.com", "Cf-Access-Jwt-Assertion": "jwt" },
      }),
    );
    const json = (await r.json()) as { auth: boolean };
    expect(json.auth).toBe(false);
  });

  it("falls through when no Cf-Access-Jwt-Assertion header on edge", async () => {
    const app = makeApp({
      CF_ACCESS_TEAM_DOMAIN: "team.cloudflareaccess.com",
      CF_ACCESS_AUD: "aud-123",
    });
    const r = await app.fetch(
      new Request("https://prod.example.com/api/me", {
        headers: { host: "prod.example.com" },
      }),
    );
    const json = (await r.json()) as { auth: boolean };
    expect(json.auth).toBe(false);
  });

  it("falls through when c.env is undefined (Hono fetch without env arg)", async () => {
    const app = new Hono<AppEnv>();
    app.use("*", accessAuth);
    app.get("/api/me", (c) =>
      c.json({
        auth: c.get("accessAuthenticated") ?? false,
      }),
    );
    // Call fetch with no env argument so c.env is undefined
    const r = await app.fetch(
      new Request("https://prod.example.com/api/me", {
        headers: { host: "prod.example.com", "Cf-Access-Jwt-Assertion": "jwt" },
      }),
    );
    const json = (await r.json()) as { auth: boolean };
    expect(json.auth).toBe(false);
  });

  it("E2E_SKIP_AUTH bypasses auth outside production", async () => {
    const app = makeApp({
      ENVIRONMENT: "test",
      E2E_SKIP_AUTH: "true",
      DEV_USER_EMAIL: "e2e@test.local",
    });
    const r = await app.fetch(
      new Request("https://otter-test.workers.dev/api/me", {
        headers: { host: "otter-test.workers.dev" },
      }),
    );
    const json = (await r.json()) as { auth: boolean; email: string };
    expect(json.auth).toBe(true);
    expect(json.email).toBe("e2e@test.local");
  });

  it("E2E_SKIP_AUTH uses dev@localhost when DEV_USER_EMAIL not set", async () => {
    const app = makeApp({ ENVIRONMENT: "test", E2E_SKIP_AUTH: "true" });
    const r = await app.fetch(
      new Request("https://otter-test.workers.dev/api/me", {
        headers: { host: "otter-test.workers.dev" },
      }),
    );
    const json = (await r.json()) as { auth: boolean; email: string };
    expect(json.auth).toBe(true);
    expect(json.email).toBe("dev@localhost");
  });

  it("E2E_SKIP_AUTH does NOT bypass in production", async () => {
    const app = makeApp({
      ENVIRONMENT: "production",
      E2E_SKIP_AUTH: "true",
      DEV_USER_EMAIL: "e2e@test.local",
    });
    const r = await app.fetch(
      new Request("https://otter.hexly.ai/api/me", {
        headers: { host: "otter.hexly.ai" },
      }),
    );
    const json = (await r.json()) as { auth: boolean };
    expect(json.auth).toBe(false);
  });
});
