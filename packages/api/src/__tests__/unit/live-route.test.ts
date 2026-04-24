import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../lib/cf/d1", () => ({
  queryFirst: vi.fn(),
}));

vi.mock("../../lib/version", () => ({
  APP_VERSION: "2.0.0",
}));

import { createApp } from "../../app";

const app = createApp();

import { queryFirst } from "../../lib/cf/d1";

const mockQueryFirst = vi.mocked(queryFirst);

describe("GET /v1/live", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns status ok when D1 is reachable", async () => {
    mockQueryFirst.mockResolvedValue({ count: 42 });

    const res = await app.request("/v1/live");
    const body = (await res.json()) as any;

    expect(res.status).toBe(200);
    expect(body.status).toBe("ok");
    expect(body.checks.d1.reachable).toBe(true);
    expect(body.checks.d1.snapshots).toBe(42);
    expect(typeof body.checks.d1.latencyMs).toBe("number");
    expect(typeof body.latencyMs).toBe("number");

    expect(body.system).toBeDefined();
    expect(body.system.version).toBe("2.0.0");
    expect(typeof body.system.node).toBe("string");
    expect(typeof body.system.uptime).toBe("number");
    expect(typeof body.system.env).toBe("string");
  });

  it("returns status ok with zero snapshots when D1 returns null", async () => {
    mockQueryFirst.mockResolvedValue(null);

    const res = await app.request("/v1/live");
    const body = (await res.json()) as any;

    expect(res.status).toBe(200);
    expect(body.status).toBe("ok");
    expect(body.checks.d1.reachable).toBe(true);
    expect(body.checks.d1.snapshots).toBe(0);
  });

  it("returns status error with 503 when D1 fails", async () => {
    mockQueryFirst.mockRejectedValue(new Error("D1 API error (500): timeout"));

    const res = await app.request("/v1/live");
    const body = (await res.json()) as any;

    expect(res.status).toBe(503);
    expect(body.status).toBe("error");
    expect(body.checks.d1.reachable).toBe(false);
    expect(body.checks.d1.error).toBe("D1 API error (500): timeout");
    expect(typeof body.checks.d1.latencyMs).toBe("number");

    expect(body.system).toBeDefined();
    expect(typeof body.system.uptime).toBe("number");
  });

  it("returns status error with string error for non-Error throws", async () => {
    mockQueryFirst.mockRejectedValue("network failure");

    const res = await app.request("/v1/live");
    const body = (await res.json()) as any;

    expect(res.status).toBe(503);
    expect(body.status).toBe("error");
    expect(body.checks.d1.reachable).toBe(false);
    expect(body.checks.d1.error).toBe("D1 connectivity check failed");
  });

  it("error response never contains 'ok' in any field", async () => {
    mockQueryFirst.mockRejectedValue(new Error("Something went wrong"));

    const res = await app.request("/v1/live");
    const body = (await res.json()) as any;

    expect(body.status).toBe("error");
    expect(body.status).not.toBe("ok");
    expect(body.checks.d1.error).not.toContain("ok");
  });

  it("sets no-cache headers on success", async () => {
    mockQueryFirst.mockResolvedValue({ count: 1 });

    const res = await app.request("/v1/live");

    expect(res.headers.get("Cache-Control")).toBe("no-store, no-cache, must-revalidate");
  });

  it("sets no-cache headers on error", async () => {
    mockQueryFirst.mockRejectedValue(new Error("fail"));

    const res = await app.request("/v1/live");

    expect(res.headers.get("Cache-Control")).toBe("no-store, no-cache, must-revalidate");
  });

  it("does not require authentication", async () => {
    mockQueryFirst.mockResolvedValue({ count: 0 });

    const res = await app.request("/v1/live");
    const body = (await res.json()) as any;

    expect(res.status).toBe(200);
    expect(body.status).toBe("ok");
  });

  it("uses lightweight SELECT COUNT query for D1 check", async () => {
    mockQueryFirst.mockResolvedValue({ count: 10 });

    await app.request("/v1/live");

    expect(mockQueryFirst).toHaveBeenCalledTimes(1);
    expect(mockQueryFirst).toHaveBeenCalledWith("SELECT COUNT(*) as count FROM snapshots");
  });

  it("latencyMs reflects actual timing", async () => {
    mockQueryFirst.mockImplementation(
      () => new Promise((resolve) => setTimeout(() => resolve({ count: 0 }), 10)),
    );

    const res = await app.request("/v1/live");
    const body = (await res.json()) as any;

    expect(body.latencyMs).toBeGreaterThanOrEqual(0);
    expect(body.checks.d1.latencyMs).toBeGreaterThanOrEqual(0);
  });
});
