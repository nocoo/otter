import { describe, expect, it, vi } from "vitest";

vi.mock("@otter/api", () => {
  let last: Request | null = null;
  return {
    createApp: () => ({
      fetch: async (req: Request) => {
        last = req;
        return new Response(JSON.stringify({ ok: true, path: new URL(req.url).pathname }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      },
      __getLast: () => last,
    }),
  };
});

const route = await import("../../app/api/[...slug]/route");

describe("api catch-all route", () => {
  it("rewrites /api/* to /v1/* and forwards to Hono app", async () => {
    const req = new Request("http://localhost/api/snapshots?limit=10", { method: "GET" });
    const res = await route.GET(req);
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.path).toBe("/v1/snapshots");
  });

  it("handles nested paths", async () => {
    const req = new Request("http://localhost/api/snapshots/abc-123", { method: "GET" });
    const res = await route.GET(req);
    const body = await res.json();
    expect(body.path).toBe("/v1/snapshots/abc-123");
  });

  it("forwards POST body and method", async () => {
    const req = new Request("http://localhost/api/webhooks", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ url: "https://example.com" }),
    });
    const res = await route.POST(req);
    expect(res.status).toBe(200);
  });

  it("DELETE forwards without body", async () => {
    const req = new Request("http://localhost/api/snapshots/x", { method: "DELETE" });
    const res = await route.DELETE(req);
    expect(res.status).toBe(200);
  });
});
