/**
 * L2 smoke tests — boot wrangler dev (CF remote, env=test) via globalSetup
 * and hit the running server over real HTTP. No mocks, no in-memory shims.
 *
 * The server is started once for the entire L2 run; this file only verifies
 * the public endpoints that don't require auth state to exist in D1.
 */

import { beforeAll, describe, expect, it } from "vitest";

const baseUrl = (() => {
  const u = process.env.OTTER_L2_BASE_URL;
  if (!u) throw new Error("OTTER_L2_BASE_URL not set — globalSetup didn't run");
  return u;
})();

describe("L2 smoke", () => {
  beforeAll(() => {
    // base URL captured at module load; sanity-check it points at loopback.
    expect(baseUrl).toMatch(/^http:\/\/127\.0\.0\.1:\d+$/);
  });

  it("GET /api/live returns 200 with status=ok and version", async () => {
    const res = await fetch(`${baseUrl}/api/live`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      status: string;
      checks: { d1: { reachable: boolean } };
      system: { version: string; env: string };
    };
    expect(body.status).toBe("ok");
    expect(body.checks.d1.reachable).toBe(true);
    expect(body.system.version).toMatch(/^\d+\.\d+\.\d+$/);
    expect(body.system.env).toBe("test");
  });

  it("GET /api/me from localhost auto-stamps dev@localhost", async () => {
    const res = await fetch(`${baseUrl}/api/me`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      email: string | null;
      authenticated: boolean;
    };
    expect(body.authenticated).toBe(true);
    expect(body.email).toBe("dev@localhost");
  });

  it("GET /health (legacy public probe) returns 200", async () => {
    const res = await fetch(`${baseUrl}/health`);
    expect(res.status).toBe(200);
  });

  it("unknown /api/* returns 404 (router fall-through, not crash)", async () => {
    const res = await fetch(`${baseUrl}/api/__no_such_route__`);
    expect(res.status).toBe(404);
  });

  it("rejects bogus Bearer token with 403", async () => {
    // Force apiKeyAuth path by sending a Bearer header — accessAuth localhost
    // bypass only kicks in WITHOUT a Bearer header. apiKeyAuth then verifies
    // the token against api_tokens and returns 403 for unknown tokens before
    // the route runs.
    const res = await fetch(`${baseUrl}/api/me`, {
      headers: { Authorization: "Bearer otk_definitely_not_real" },
    });
    expect(res.status).toBe(403);
    const body = (await res.json()) as { error: string };
    expect(body.error).toMatch(/invalid api key/i);
  });
});
