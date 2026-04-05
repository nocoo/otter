import { createExecutionContext, env, waitOnExecutionContext } from "cloudflare:test";
import { beforeAll, describe, expect, it } from "vitest";
import app from "../index.js";
import "../test-env.d.js";

interface IngestResponse {
  success?: boolean;
  snapshotId?: string;
  error?: string;
}

const VALID_TOKEN = "test-webhook-token";
const DISABLED_TOKEN = "disabled-webhook-token";

const mockSnapshot = {
  version: 1 as const,
  id: "test-snapshot-id-123",
  createdAt: new Date().toISOString(),
  machine: {
    hostname: "test-machine",
    computerName: "Test Machine",
    platform: "darwin",
    arch: "arm64",
    username: "testuser",
  },
  collectors: [
    { files: [{ path: "/test/file1" }], lists: [{ name: "item1" }, { name: "item2" }] },
    { files: [], lists: [{ name: "item3" }] },
  ],
};

describe("Ingest API", () => {
  beforeAll(async () => {
    // Seed test database
    await env.DB.exec(
      "CREATE TABLE IF NOT EXISTS webhooks (id TEXT PRIMARY KEY, user_id TEXT NOT NULL, token TEXT UNIQUE NOT NULL, name TEXT NOT NULL, is_active INTEGER DEFAULT 1, created_at INTEGER NOT NULL, last_used_at INTEGER)",
    );
    await env.DB.exec(
      "CREATE TABLE IF NOT EXISTS snapshots (id TEXT PRIMARY KEY, user_id TEXT NOT NULL, webhook_id TEXT NOT NULL, hostname TEXT NOT NULL, platform TEXT NOT NULL, arch TEXT NOT NULL, username TEXT NOT NULL, collector_count INTEGER NOT NULL, file_count INTEGER NOT NULL, list_count INTEGER NOT NULL, size_bytes INTEGER NOT NULL, r2_key TEXT NOT NULL, snapshot_at INTEGER NOT NULL, uploaded_at INTEGER NOT NULL)",
    );

    // Insert test webhooks
    await env.DB.prepare(
      "INSERT OR REPLACE INTO webhooks (id, user_id, token, name, is_active, created_at) VALUES (?, ?, ?, ?, ?, ?)",
    )
      .bind("webhook-1", "test-user-id", VALID_TOKEN, "Test Webhook", 1, Date.now())
      .run();

    await env.DB.prepare(
      "INSERT OR REPLACE INTO webhooks (id, user_id, token, name, is_active, created_at) VALUES (?, ?, ?, ?, ?, ?)",
    )
      .bind("webhook-2", "test-user-id", DISABLED_TOKEN, "Disabled Webhook", 0, Date.now())
      .run();
  });

  it("POST /ingest/{token} with valid token creates snapshot", async () => {
    const body = JSON.stringify(mockSnapshot);

    const req = new Request(`http://localhost/ingest/${VALID_TOKEN}`, {
      method: "POST",
      body,
      headers: { "Content-Type": "application/json" },
    });
    const ctx = createExecutionContext();
    const res = await app.fetch(req, env, ctx);
    await waitOnExecutionContext(ctx);

    expect(res.status).toBe(201);
    const json = (await res.json()) as IngestResponse;
    expect(json.success).toBe(true);
    expect(json.snapshotId).toBe(mockSnapshot.id);

    // Verify D1 record
    const dbRow = await env.DB.prepare("SELECT * FROM snapshots WHERE id = ?")
      .bind(mockSnapshot.id)
      .first();
    expect(dbRow).toBeTruthy();
    expect(dbRow?.hostname).toBe("Test Machine");
    expect(dbRow?.platform).toBe("darwin");
    expect(dbRow?.collector_count).toBe(2);
    expect(dbRow?.file_count).toBe(1);
    expect(dbRow?.list_count).toBe(3);

    // Verify R2 object
    const r2Object = await env.SNAPSHOTS.get(`test-user-id/${mockSnapshot.id}.json`);
    expect(r2Object).toBeTruthy();
    const r2Content = await r2Object?.text();
    expect(r2Content).toBe(body);
  });

  it("POST /ingest/{token} with invalid token returns 401", async () => {
    const req = new Request("http://localhost/ingest/invalid-token", {
      method: "POST",
      body: JSON.stringify(mockSnapshot),
      headers: { "Content-Type": "application/json" },
    });
    const ctx = createExecutionContext();
    const res = await app.fetch(req, env, ctx);
    await waitOnExecutionContext(ctx);

    expect(res.status).toBe(401);
    const json = (await res.json()) as IngestResponse;
    expect(json.error).toBe("Invalid webhook token");
  });

  it("POST /ingest/{token} with disabled webhook returns 403", async () => {
    const req = new Request(`http://localhost/ingest/${DISABLED_TOKEN}`, {
      method: "POST",
      body: JSON.stringify(mockSnapshot),
      headers: { "Content-Type": "application/json" },
    });
    const ctx = createExecutionContext();
    const res = await app.fetch(req, env, ctx);
    await waitOnExecutionContext(ctx);

    expect(res.status).toBe(403);
    const json = (await res.json()) as IngestResponse;
    expect(json.error).toBe("Webhook is disabled");
  });

  it("POST /ingest/{token} with invalid JSON returns 400", async () => {
    const req = new Request(`http://localhost/ingest/${VALID_TOKEN}`, {
      method: "POST",
      body: "not valid json",
      headers: { "Content-Type": "application/json" },
    });
    const ctx = createExecutionContext();
    const res = await app.fetch(req, env, ctx);
    await waitOnExecutionContext(ctx);

    expect(res.status).toBe(400);
    const json = (await res.json()) as IngestResponse;
    expect(json.error).toBe("Invalid JSON body");
  });

  it("POST /ingest/{token} with invalid snapshot format returns 400", async () => {
    const invalidSnapshot = { ...mockSnapshot, version: 2 }; // Wrong version

    const req = new Request(`http://localhost/ingest/${VALID_TOKEN}`, {
      method: "POST",
      body: JSON.stringify(invalidSnapshot),
      headers: { "Content-Type": "application/json" },
    });
    const ctx = createExecutionContext();
    const res = await app.fetch(req, env, ctx);
    await waitOnExecutionContext(ctx);

    expect(res.status).toBe(400);
    const json = (await res.json()) as IngestResponse;
    expect(json.error).toBe("Invalid snapshot format");
  });

  it("POST /ingest/{token} updates webhook last_used_at", async () => {
    const uniqueSnapshot = {
      ...mockSnapshot,
      id: `snapshot-for-timestamp-test-${Date.now()}`,
    };

    const beforeReq = await env.DB.prepare("SELECT last_used_at FROM webhooks WHERE token = ?")
      .bind(VALID_TOKEN)
      .first<{ last_used_at: number | null }>();

    const req = new Request(`http://localhost/ingest/${VALID_TOKEN}`, {
      method: "POST",
      body: JSON.stringify(uniqueSnapshot),
      headers: { "Content-Type": "application/json" },
    });
    const ctx = createExecutionContext();
    const res = await app.fetch(req, env, ctx);
    await waitOnExecutionContext(ctx);

    expect(res.status).toBe(201);

    const afterReq = await env.DB.prepare("SELECT last_used_at FROM webhooks WHERE token = ?")
      .bind(VALID_TOKEN)
      .first<{ last_used_at: number | null }>();

    expect(afterReq?.last_used_at).toBeTruthy();
    // last_used_at should be updated (could be null before if first use)
    if (beforeReq?.last_used_at) {
      expect(afterReq?.last_used_at).toBeGreaterThanOrEqual(beforeReq.last_used_at);
    }
  });
});
