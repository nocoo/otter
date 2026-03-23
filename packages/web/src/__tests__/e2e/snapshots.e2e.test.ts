/**
 * L3 API E2E: Snapshots API
 *
 * Tests the snapshots listing and detail endpoints.
 * These tests only verify response structure and status codes —
 * actual snapshot data depends on what exists in D1/R2.
 */

import { describe, expect, it } from "bun:test";

const BASE_URL = `http://localhost:${process.env.E2E_PORT || "17029"}`;

describe("L3 API E2E: Snapshots", () => {
  it("GET /api/snapshots returns 200 with correct structure", async () => {
    const res = await fetch(`${BASE_URL}/api/snapshots`);
    expect(res.status).toBe(200);

    const data = await res.json();
    expect(data).toHaveProperty("snapshots");
    expect(data).toHaveProperty("total");
    expect(data).toHaveProperty("nextBefore");
    expect(Array.isArray(data.snapshots)).toBe(true);
    expect(typeof data.total).toBe("number");
  });

  it("GET /api/snapshots respects limit param", async () => {
    const res = await fetch(`${BASE_URL}/api/snapshots?limit=2`);
    expect(res.status).toBe(200);

    const data = await res.json();
    expect(data.snapshots.length).toBeLessThanOrEqual(2);
  });

  it("GET /api/snapshots/non-existent returns 404", async () => {
    const res = await fetch(`${BASE_URL}/api/snapshots/00000000-0000-0000-0000-000000000000`);
    expect(res.status).toBe(404);
  });

  it("GET /api/snapshots validates snapshot row shape", async () => {
    const res = await fetch(`${BASE_URL}/api/snapshots?limit=1`);
    const data = await res.json();

    if (data.snapshots.length > 0) {
      const snap = data.snapshots[0];
      expect(typeof snap.id).toBe("string");
      expect(typeof snap.hostname).toBe("string");
      expect(typeof snap.platform).toBe("string");
      expect(typeof snap.arch).toBe("string");
      expect(typeof snap.collectorCount).toBe("number");
      expect(typeof snap.fileCount).toBe("number");
      expect(typeof snap.listCount).toBe("number");
      expect(typeof snap.sizeBytes).toBe("number");
      expect(typeof snap.snapshotAt).toBe("number");
      expect(typeof snap.uploadedAt).toBe("number");
    }
  });
});
