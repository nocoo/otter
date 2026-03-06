/**
 * L3 API E2E: Webhook Receiver
 *
 * Tests the full webhook receiver flow:
 *  1. Create a webhook token
 *  2. POST a gzip-compressed snapshot to /api/webhook/:token
 *  3. Verify the snapshot appears in the snapshots list
 *  4. Clean up: delete the snapshot and webhook
 *
 * This is the most important E2E test — it exercises the entire
 * ingest pipeline: gzip decompression → R2 storage → D1 indexing.
 */

import { describe, it, expect, afterAll } from "bun:test";
import { gzipSync } from "bun";

const BASE_URL = `http://localhost:${process.env.E2E_PORT || "17029"}`;

// Track resources for cleanup
let webhookId: string | null = null;
let webhookToken: string | null = null;
let snapshotId: string | null = null;

// Generate a unique snapshot ID for this test run to avoid D1 PK conflicts
const testSnapshotId = `e2e-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

// Minimal valid snapshot payload matching the webhook receiver's validation:
//   - version: 1 (required)
//   - id: string (required)
//   - createdAt: ISO string (required)
//   - machine: { hostname, platform, arch, username } (required)
//   - collectors: Array<{ files: [], lists: [] }> (required)
const testSnapshot = {
  version: 1,
  id: testSnapshotId,
  createdAt: new Date().toISOString(),
  machine: {
    hostname: "e2e-test-host",
    platform: "darwin",
    arch: "arm64",
    username: "e2e-tester",
  },
  collectors: [
    {
      name: "E2E Test Collector",
      version: "1.0.0",
      collectedAt: new Date().toISOString(),
      files: [
        {
          relativePath: "test-config.json",
          content: '{"key": "value"}',
          sizeBytes: 16,
        },
      ],
      lists: [
        {
          name: "test-packages",
          items: ["pkg-a", "pkg-b", "pkg-c"],
        },
      ],
    },
  ],
};

afterAll(async () => {
  // Clean up snapshot from D1 (no delete API yet, but we can verify it exists)
  // In a real cleanup we'd need a DELETE /api/snapshots/:id route
  // For now, the E2E test user data is isolated by user_id="e2e-test-user"

  // Clean up webhook
  if (webhookId) {
    try {
      await fetch(`${BASE_URL}/api/webhooks/${webhookId}`, {
        method: "DELETE",
      });
    } catch {
      // Best-effort cleanup
    }
  }
});

describe("L3 API E2E: Webhook Receiver", () => {
  it("creates a webhook token for testing", async () => {
    const res = await fetch(`${BASE_URL}/api/webhooks`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ label: "e2e-receiver-test" }),
    });
    expect(res.status).toBe(201);

    const data = await res.json();
    webhookId = data.webhook.id;
    webhookToken = data.webhook.token;

    expect(typeof webhookToken).toBe("string");
  });

  it("POST /api/webhook/:token accepts gzip snapshot", async () => {
    expect(webhookToken).not.toBeNull();

    const jsonBytes = new TextEncoder().encode(JSON.stringify(testSnapshot));
    const compressed = gzipSync(jsonBytes);

    const res = await fetch(`${BASE_URL}/api/webhook/${webhookToken}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Content-Encoding": "gzip",
      },
      body: compressed,
    });
    expect(res.status).toBe(201);

    const data = await res.json();
    expect(data).toHaveProperty("success", true);
    expect(data).toHaveProperty("snapshotId", testSnapshotId);

    snapshotId = data.snapshotId;
  });

  it("snapshot appears in the snapshots list", async () => {
    expect(snapshotId).not.toBeNull();

    const res = await fetch(`${BASE_URL}/api/snapshots?limit=10`);
    expect(res.status).toBe(200);

    const data = await res.json();
    const found = data.snapshots.find(
      (s: { id: string }) => s.id === snapshotId,
    );
    expect(found).toBeDefined();
    expect(found.hostname).toBe("e2e-test-host");
    expect(found.platform).toBe("darwin");
    expect(found.arch).toBe("arm64");
  });

  it("snapshot detail returns full data from R2", async () => {
    expect(snapshotId).not.toBeNull();

    const res = await fetch(`${BASE_URL}/api/snapshots/${snapshotId}`);
    expect(res.status).toBe(200);

    const data = await res.json();
    // Metadata from D1 (nested under `snapshot`)
    expect(data).toHaveProperty("snapshot");
    expect(data.snapshot).toHaveProperty("id", snapshotId);
    expect(data.snapshot).toHaveProperty("hostname", "e2e-test-host");

    // Full snapshot data from R2
    expect(data).toHaveProperty("data");
    expect(data.data).toHaveProperty("machine");
    expect(data.data.machine.hostname).toBe("e2e-test-host");
    expect(data.data).toHaveProperty("collectors");
    expect(data.data.collectors).toHaveLength(1);
  });

  it("POST /api/webhook/:token rejects invalid token", async () => {
    const jsonBytes = new TextEncoder().encode(JSON.stringify(testSnapshot));
    const compressed = gzipSync(jsonBytes);

    const res = await fetch(
      `${BASE_URL}/api/webhook/00000000-0000-0000-0000-000000000000`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Content-Encoding": "gzip",
        },
        body: compressed,
      },
    );
    expect(res.status).toBe(401);
  });

  it("POST /api/webhook/:token accepts raw JSON without gzip", async () => {
    expect(webhookToken).not.toBeNull();

    // Use a different snapshot ID to avoid PK collision
    const rawSnapshot = {
      ...testSnapshot,
      id: `e2e-raw-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    };

    const res = await fetch(`${BASE_URL}/api/webhook/${webhookToken}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(rawSnapshot),
    });
    // Route accepts raw JSON when Content-Encoding is not gzip
    expect(res.status).toBe(201);

    const data = await res.json();
    expect(data).toHaveProperty("success", true);
    expect(data).toHaveProperty("snapshotId", rawSnapshot.id);
  });
});
