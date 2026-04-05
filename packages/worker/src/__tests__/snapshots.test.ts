import { createExecutionContext, env, waitOnExecutionContext } from "cloudflare:test";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import app from "../index.js";

const API_KEY = "test-api-key";
const TEST_USER_ID = "user-123";

// Helper to make authenticated requests
function makeAuthHeaders(userId = TEST_USER_ID): Record<string, string> {
  return {
    "X-API-Key": API_KEY,
    "X-User-ID": userId,
    "Content-Type": "application/json",
  };
}

async function seedSnapshot(
  db: D1Database,
  id: string,
  userId: string,
  uploadedAt: number,
): Promise<void> {
  await db
    .prepare(
      `INSERT INTO snapshots (id, user_id, webhook_id, hostname, platform, arch, username,
        collector_count, file_count, list_count, size_bytes, r2_key, snapshot_at, uploaded_at)
       VALUES (?1, ?2, 'wh-1', 'test-host', 'darwin', 'arm64', 'testuser',
        5, 10, 100, 1024, ?3, ?4, ?5)`,
    )
    .bind(id, userId, `${userId}/${id}.json`, uploadedAt - 1000, uploadedAt)
    .run();
}

describe("/v1/snapshots routes", () => {
  beforeEach(async () => {
    // Seed test user for FK constraint
    await env.DB.prepare(
      `INSERT OR IGNORE INTO users (id, email, name, created_at) VALUES (?1, ?2, ?3, ?4)`,
    )
      .bind(TEST_USER_ID, "test@example.com", "Test User", Date.now())
      .run();

    // Seed webhook for FK constraint
    await env.DB.prepare(
      `INSERT OR IGNORE INTO webhooks (id, user_id, token, label, is_active, created_at) VALUES (?1, ?2, ?3, ?4, 1, ?5)`,
    )
      .bind("wh-1", TEST_USER_ID, "tok-test", "Test Webhook", Date.now())
      .run();
  });

  afterEach(async () => {
    // Clean up snapshots
    await env.DB.prepare(`DELETE FROM snapshots`).run();
  });

  describe("GET /v1/snapshots", () => {
    it("returns 401 without API key", async () => {
      const ctx = createExecutionContext();
      const res = await app.fetch(
        new Request("http://localhost/v1/snapshots", {
          headers: { "X-User-ID": TEST_USER_ID },
        }),
        env,
        ctx,
      );
      await waitOnExecutionContext(ctx);

      expect(res.status).toBe(401);
    });

    it("returns 400 without X-User-ID", async () => {
      const ctx = createExecutionContext();
      const res = await app.fetch(
        new Request("http://localhost/v1/snapshots", {
          headers: { "X-API-Key": API_KEY },
        }),
        env,
        ctx,
      );
      await waitOnExecutionContext(ctx);

      expect(res.status).toBe(400);
    });

    it("returns empty list when no snapshots exist", async () => {
      const ctx = createExecutionContext();
      const res = await app.fetch(
        new Request("http://localhost/v1/snapshots", {
          headers: makeAuthHeaders(),
        }),
        env,
        ctx,
      );
      await waitOnExecutionContext(ctx);

      expect(res.status).toBe(200);
      const data = (await res.json()) as {
        snapshots: unknown[];
        total: number;
        nextBefore: number | null;
      };
      expect(data.snapshots).toEqual([]);
      expect(data.total).toBe(0);
      expect(data.nextBefore).toBeNull();
    });

    it("returns snapshots for the user", async () => {
      const now = Date.now();
      await seedSnapshot(env.DB, "snap-1", TEST_USER_ID, now);
      await seedSnapshot(env.DB, "snap-2", TEST_USER_ID, now - 1000);

      const ctx = createExecutionContext();
      const res = await app.fetch(
        new Request("http://localhost/v1/snapshots", {
          headers: makeAuthHeaders(),
        }),
        env,
        ctx,
      );
      await waitOnExecutionContext(ctx);

      expect(res.status).toBe(200);
      const data = (await res.json()) as { snapshots: { id: string }[]; total: number };
      expect(data.snapshots).toHaveLength(2);
      expect(data.total).toBe(2);
      // Most recent first
      expect(data.snapshots[0]?.id).toBe("snap-1");
    });

    it("respects limit parameter", async () => {
      const now = Date.now();
      await seedSnapshot(env.DB, "snap-1", TEST_USER_ID, now);
      await seedSnapshot(env.DB, "snap-2", TEST_USER_ID, now - 1000);
      await seedSnapshot(env.DB, "snap-3", TEST_USER_ID, now - 2000);

      const ctx = createExecutionContext();
      const res = await app.fetch(
        new Request("http://localhost/v1/snapshots?limit=2", {
          headers: makeAuthHeaders(),
        }),
        env,
        ctx,
      );
      await waitOnExecutionContext(ctx);

      expect(res.status).toBe(200);
      const data = (await res.json()) as { snapshots: unknown[]; nextBefore: number | null };
      expect(data.snapshots).toHaveLength(2);
      expect(data.nextBefore).not.toBeNull();
    });

    it("respects before cursor", async () => {
      const now = Date.now();
      await seedSnapshot(env.DB, "snap-1", TEST_USER_ID, now);
      await seedSnapshot(env.DB, "snap-2", TEST_USER_ID, now - 1000);

      const ctx = createExecutionContext();
      const res = await app.fetch(
        new Request(`http://localhost/v1/snapshots?before=${now}`, {
          headers: makeAuthHeaders(),
        }),
        env,
        ctx,
      );
      await waitOnExecutionContext(ctx);

      expect(res.status).toBe(200);
      const data = (await res.json()) as { snapshots: { id: string }[] };
      expect(data.snapshots).toHaveLength(1);
      expect(data.snapshots[0]?.id).toBe("snap-2");
    });

    it("does not return other users snapshots", async () => {
      const now = Date.now();
      await seedSnapshot(env.DB, "snap-1", TEST_USER_ID, now);

      // Seed another user and their snapshot
      await env.DB.prepare(
        `INSERT OR IGNORE INTO users (id, email, name, created_at) VALUES (?1, ?2, ?3, ?4)`,
      )
        .bind("other-user", "other@example.com", "Other User", Date.now())
        .run();

      await env.DB.prepare(
        `INSERT OR IGNORE INTO webhooks (id, user_id, token, label, is_active, created_at) VALUES (?1, ?2, ?3, ?4, 1, ?5)`,
      )
        .bind("wh-other", "other-user", "tok-other", "Other Webhook", Date.now())
        .run();

      await env.DB.prepare(
        `INSERT INTO snapshots (id, user_id, webhook_id, hostname, platform, arch, username,
          collector_count, file_count, list_count, size_bytes, r2_key, snapshot_at, uploaded_at)
         VALUES (?1, ?2, 'wh-other', 'other-host', 'linux', 'x64', 'other',
          1, 1, 1, 100, 'other-user/snap-other.json', ?3, ?4)`,
      )
        .bind("snap-other", "other-user", now, now)
        .run();

      const ctx = createExecutionContext();
      const res = await app.fetch(
        new Request("http://localhost/v1/snapshots", {
          headers: makeAuthHeaders(),
        }),
        env,
        ctx,
      );
      await waitOnExecutionContext(ctx);

      expect(res.status).toBe(200);
      const data = (await res.json()) as { snapshots: { id: string }[]; total: number };
      expect(data.snapshots).toHaveLength(1);
      expect(data.snapshots[0]?.id).toBe("snap-1");
      expect(data.total).toBe(1);
    });
  });

  describe("GET /v1/snapshots/:id", () => {
    it("returns 404 when snapshot not found", async () => {
      const ctx = createExecutionContext();
      const res = await app.fetch(
        new Request("http://localhost/v1/snapshots/nonexistent", {
          headers: makeAuthHeaders(),
        }),
        env,
        ctx,
      );
      await waitOnExecutionContext(ctx);

      expect(res.status).toBe(404);
      const data = (await res.json()) as { error: string };
      expect(data.error).toBe("Snapshot not found");
    });

    it("returns 404 when snapshot belongs to another user", async () => {
      const now = Date.now();

      // Seed another user and their snapshot
      await env.DB.prepare(
        `INSERT OR IGNORE INTO users (id, email, name, created_at) VALUES (?1, ?2, ?3, ?4)`,
      )
        .bind("other-user", "other@example.com", "Other User", now)
        .run();

      await env.DB.prepare(
        `INSERT OR IGNORE INTO webhooks (id, user_id, token, label, is_active, created_at) VALUES (?1, ?2, ?3, ?4, 1, ?5)`,
      )
        .bind("wh-other", "other-user", "tok-other", "Other", now)
        .run();

      await env.DB.prepare(
        `INSERT INTO snapshots (id, user_id, webhook_id, hostname, platform, arch, username,
          collector_count, file_count, list_count, size_bytes, r2_key, snapshot_at, uploaded_at)
         VALUES (?1, ?2, 'wh-other', 'host', 'linux', 'x64', 'user',
          1, 1, 1, 100, 'other-user/snap-other.json', ?3, ?4)`,
      )
        .bind("snap-other", "other-user", now, now)
        .run();

      const ctx = createExecutionContext();
      const res = await app.fetch(
        new Request("http://localhost/v1/snapshots/snap-other", {
          headers: makeAuthHeaders(),
        }),
        env,
        ctx,
      );
      await waitOnExecutionContext(ctx);

      expect(res.status).toBe(404);
    });
  });

  describe("DELETE /v1/snapshots/:id", () => {
    it("returns 404 when snapshot not found", async () => {
      const ctx = createExecutionContext();
      const res = await app.fetch(
        new Request("http://localhost/v1/snapshots/nonexistent", {
          method: "DELETE",
          headers: makeAuthHeaders(),
        }),
        env,
        ctx,
      );
      await waitOnExecutionContext(ctx);

      expect(res.status).toBe(404);
    });

    it("deletes snapshot from D1", async () => {
      const now = Date.now();
      await seedSnapshot(env.DB, "snap-to-delete", TEST_USER_ID, now);

      // Verify it exists
      const before = await env.DB.prepare(`SELECT id FROM snapshots WHERE id = ?1`)
        .bind("snap-to-delete")
        .first();
      expect(before).not.toBeNull();

      const ctx = createExecutionContext();
      const res = await app.fetch(
        new Request("http://localhost/v1/snapshots/snap-to-delete", {
          method: "DELETE",
          headers: makeAuthHeaders(),
        }),
        env,
        ctx,
      );
      await waitOnExecutionContext(ctx);

      expect(res.status).toBe(200);
      const data = (await res.json()) as { success: boolean };
      expect(data.success).toBe(true);

      // Verify it's deleted
      const after = await env.DB.prepare(`SELECT id FROM snapshots WHERE id = ?1`)
        .bind("snap-to-delete")
        .first();
      expect(after).toBeNull();
    });
  });
});
