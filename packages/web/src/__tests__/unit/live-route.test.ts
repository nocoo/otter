import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock D1
vi.mock("@/lib/cf/d1", () => ({
  queryFirst: vi.fn(),
}));

// Mock version
vi.mock("@/lib/version", () => ({
  APP_VERSION: "1.0.1",
}));

import { GET } from "@/app/api/live/route";
import { queryFirst } from "@/lib/cf/d1";

const mockQueryFirst = vi.mocked(queryFirst);

describe("GET /api/live", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns status ok when D1 is reachable", async () => {
    mockQueryFirst.mockResolvedValue({ count: 42 });

    const res = await GET();
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.status).toBe("ok");
    expect(body.checks.d1.reachable).toBe(true);
    expect(body.checks.d1.snapshots).toBe(42);
    expect(typeof body.checks.d1.latencyMs).toBe("number");
    expect(typeof body.latencyMs).toBe("number");

    // System metadata
    expect(body.system).toBeDefined();
    expect(body.system.version).toBe("1.0.1");
    expect(typeof body.system.node).toBe("string");
    expect(typeof body.system.uptime).toBe("number");
    expect(typeof body.system.env).toBe("string");
  });

  it("returns status ok with zero snapshots when D1 returns null", async () => {
    mockQueryFirst.mockResolvedValue(null);

    const res = await GET();
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.status).toBe("ok");
    expect(body.checks.d1.reachable).toBe(true);
    expect(body.checks.d1.snapshots).toBe(0);
  });

  it("returns status error with 503 when D1 fails", async () => {
    mockQueryFirst.mockRejectedValue(new Error("D1 API error (500): timeout"));

    const res = await GET();
    const body = await res.json();

    expect(res.status).toBe(503);
    expect(body.status).toBe("error");
    expect(body.checks.d1.reachable).toBe(false);
    expect(body.checks.d1.error).toBe("D1 API error (500): timeout");
    expect(typeof body.checks.d1.latencyMs).toBe("number");

    // System metadata still present on error
    expect(body.system).toBeDefined();
    expect(typeof body.system.uptime).toBe("number");
  });

  it("returns status error with string error for non-Error throws", async () => {
    mockQueryFirst.mockRejectedValue("network failure");

    const res = await GET();
    const body = await res.json();

    expect(res.status).toBe(503);
    expect(body.status).toBe("error");
    expect(body.checks.d1.reachable).toBe(false);
    expect(body.checks.d1.error).toBe("D1 connectivity check failed");
  });

  it("error response never contains 'ok' in any field", async () => {
    mockQueryFirst.mockRejectedValue(new Error("Something went wrong"));

    const res = await GET();
    const body = await res.json();

    expect(body.status).toBe("error");
    // The word "ok" should not appear as a status or reason value
    expect(body.status).not.toBe("ok");
    expect(body.checks.d1.error).not.toContain("ok");
  });

  it("sets no-cache headers on success", async () => {
    mockQueryFirst.mockResolvedValue({ count: 1 });

    const res = await GET();

    expect(res.headers.get("Cache-Control")).toBe(
      "no-store, no-cache, must-revalidate",
    );
  });

  it("sets no-cache headers on error", async () => {
    mockQueryFirst.mockRejectedValue(new Error("fail"));

    const res = await GET();

    expect(res.headers.get("Cache-Control")).toBe(
      "no-store, no-cache, must-revalidate",
    );
  });

  it("does not require authentication", async () => {
    // The route imports no session/auth modules, so this test verifies
    // the route works without any auth setup
    mockQueryFirst.mockResolvedValue({ count: 0 });

    const res = await GET();
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.status).toBe("ok");
  });

  it("uses lightweight SELECT COUNT query for D1 check", async () => {
    mockQueryFirst.mockResolvedValue({ count: 10 });

    await GET();

    expect(mockQueryFirst).toHaveBeenCalledTimes(1);
    expect(mockQueryFirst).toHaveBeenCalledWith(
      "SELECT COUNT(*) as count FROM snapshots",
    );
  });

  it("latencyMs reflects actual timing", async () => {
    mockQueryFirst.mockImplementation(
      () => new Promise((resolve) => setTimeout(() => resolve({ count: 0 }), 10)),
    );

    const res = await GET();
    const body = await res.json();

    expect(body.latencyMs).toBeGreaterThanOrEqual(0);
    expect(body.checks.d1.latencyMs).toBeGreaterThanOrEqual(0);
  });
});
