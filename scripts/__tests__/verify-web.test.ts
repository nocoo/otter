import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { version } from "../../package.json";
import { verifyWeb } from "../verify-web";

const html =
  '<div id="root"></div><script src="/assets/app.js"></script><link href="/assets/app.css">';
let responses: Map<string, Response>;

beforeEach(() => {
  responses = new Map([
    ["/api/live", Response.json({ status: "ok", version })],
    ["/", new Response(html)],
    ["/settings", new Response(html)],
    [
      "/assets/app.js",
      new Response("console.log('Otter')", { headers: { "Content-Type": "text/javascript" } }),
    ],
    ["/assets/app.css", new Response("body {}", { headers: { "Content-Type": "text/css" } })],
  ]);
  vi.stubGlobal(
    "fetch",
    vi.fn((url: URL) => responses.get(url.pathname) ?? new Response(null, { status: 404 })),
  );
});

afterEach(() => vi.unstubAllGlobals());

describe("Web deployment verification", () => {
  it("accepts a healthy Worker with built assets and SPA fallback", async () => {
    await verifyWeb("http://localhost:8787");
    expect(fetch).toHaveBeenCalledTimes(5);
  });

  it("rejects a stale API version", async () => {
    responses.set("/api/live", Response.json({ status: "ok", version: "0.0.0" }));
    await expect(verifyWeb("http://localhost:8787")).rejects.toThrow("Deployed version");
  });

  it("rejects missing JavaScript even if SPA fallback returns HTTP 200", async () => {
    responses.set(
      "/assets/app.js",
      new Response(html, { headers: { "Content-Type": "text/html" } }),
    );
    await expect(verifyWeb("http://localhost:8787")).rejects.toThrow("expected javascript");
  });

  it("rejects a broken deep link", async () => {
    responses.set("/settings", new Response("Not Found", { status: 404 }));
    await expect(verifyWeb("http://localhost:8787")).rejects.toThrow("/settings: HTTP 404");
  });
});
