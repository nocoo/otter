/**
 * L3 API E2E: Health check smoke test
 *
 * Verifies the dev server is running and responds to requests.
 * Run via: bun run test:e2e
 */

import { describe, expect, it } from "bun:test";

const BASE_URL = `http://localhost:${process.env.E2E_PORT || "17029"}`;

describe("L3 API E2E: Health", () => {
  it("GET /login returns 200", async () => {
    const res = await fetch(`${BASE_URL}/login`);
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain("Sign in with Google");
  });

  it("GET / redirects unauthenticated users", async () => {
    const res = await fetch(`${BASE_URL}/`, { redirect: "manual" });
    // Should redirect to login (302) or serve login page
    expect([200, 302, 307]).toContain(res.status);
  });
});
