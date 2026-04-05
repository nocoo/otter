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

describe("/v1/webhooks routes", () => {
  beforeEach(async () => {
    // Seed test user for FK constraint
    await env.DB.prepare(
      `INSERT OR IGNORE INTO users (id, email, name, created_at) VALUES (?1, ?2, ?3, ?4)`,
    )
      .bind(TEST_USER_ID, "test@example.com", "Test User", Date.now())
      .run();
  });

  afterEach(async () => {
    // Clean up webhooks (preserve the user for next test)
    await env.DB.prepare(`DELETE FROM webhooks WHERE user_id = ?1`).bind(TEST_USER_ID).run();
  });

  describe("GET /v1/webhooks", () => {
    it("returns 401 without API key", async () => {
      const ctx = createExecutionContext();
      const res = await app.fetch(
        new Request("http://localhost/v1/webhooks", {
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
        new Request("http://localhost/v1/webhooks", {
          headers: { "X-API-Key": API_KEY },
        }),
        env,
        ctx,
      );
      await waitOnExecutionContext(ctx);

      expect(res.status).toBe(400);
    });

    it("returns empty list when no webhooks exist", async () => {
      const ctx = createExecutionContext();
      const res = await app.fetch(
        new Request("http://localhost/v1/webhooks", {
          headers: makeAuthHeaders(),
        }),
        env,
        ctx,
      );
      await waitOnExecutionContext(ctx);

      expect(res.status).toBe(200);
      const data = (await res.json()) as { webhooks: unknown[] };
      expect(data.webhooks).toEqual([]);
    });

    it("returns webhooks for the user", async () => {
      const now = Date.now();
      await env.DB.prepare(
        `INSERT INTO webhooks (id, user_id, token, label, is_active, created_at, last_used_at)
         VALUES (?1, ?2, ?3, ?4, 1, ?5, ?6)`,
      )
        .bind("wh-1", TEST_USER_ID, "tok-1", "Webhook 1", now, now + 1000)
        .run();

      await env.DB.prepare(
        `INSERT INTO webhooks (id, user_id, token, label, is_active, created_at, last_used_at)
         VALUES (?1, ?2, ?3, ?4, 0, ?5, NULL)`,
      )
        .bind("wh-2", TEST_USER_ID, "tok-2", "Webhook 2", now - 1000)
        .run();

      const ctx = createExecutionContext();
      const res = await app.fetch(
        new Request("http://localhost/v1/webhooks", {
          headers: makeAuthHeaders(),
        }),
        env,
        ctx,
      );
      await waitOnExecutionContext(ctx);

      expect(res.status).toBe(200);
      const data = (await res.json()) as {
        webhooks: { id: string; isActive: boolean; lastUsedAt: number | null }[];
      };
      expect(data.webhooks).toHaveLength(2);
      // Most recent first
      expect(data.webhooks[0]?.id).toBe("wh-1");
      expect(data.webhooks[0]?.isActive).toBe(true);
      expect(data.webhooks[0]?.lastUsedAt).toBe(now + 1000);
      expect(data.webhooks[1]?.isActive).toBe(false);
      expect(data.webhooks[1]?.lastUsedAt).toBeNull();
    });

    it("does not return other users webhooks", async () => {
      const now = Date.now();
      await env.DB.prepare(
        `INSERT INTO webhooks (id, user_id, token, label, is_active, created_at)
         VALUES (?1, ?2, ?3, ?4, 1, ?5)`,
      )
        .bind("wh-mine", TEST_USER_ID, "tok-mine", "Mine", now)
        .run();

      // Seed another user and webhook
      await env.DB.prepare(
        `INSERT OR IGNORE INTO users (id, email, name, created_at) VALUES (?1, ?2, ?3, ?4)`,
      )
        .bind("other-user", "other@example.com", "Other", now)
        .run();

      await env.DB.prepare(
        `INSERT INTO webhooks (id, user_id, token, label, is_active, created_at)
         VALUES (?1, ?2, ?3, ?4, 1, ?5)`,
      )
        .bind("wh-other", "other-user", "tok-other", "Other", now)
        .run();

      const ctx = createExecutionContext();
      const res = await app.fetch(
        new Request("http://localhost/v1/webhooks", {
          headers: makeAuthHeaders(),
        }),
        env,
        ctx,
      );
      await waitOnExecutionContext(ctx);

      const data = (await res.json()) as { webhooks: { id: string }[] };
      expect(data.webhooks).toHaveLength(1);
      expect(data.webhooks[0]?.id).toBe("wh-mine");
    });
  });

  describe("POST /v1/webhooks", () => {
    it("creates a webhook with default label", async () => {
      const ctx = createExecutionContext();
      const res = await app.fetch(
        new Request("http://localhost/v1/webhooks", {
          method: "POST",
          headers: makeAuthHeaders(),
          body: JSON.stringify({}),
        }),
        env,
        ctx,
      );
      await waitOnExecutionContext(ctx);

      expect(res.status).toBe(201);
      const data = (await res.json()) as {
        webhook: { id: string; token: string; label: string; isActive: boolean };
      };
      expect(data.webhook.id).toBeTruthy();
      expect(data.webhook.token).toBeTruthy();
      expect(data.webhook.label).toBe("Default");
      expect(data.webhook.isActive).toBe(true);

      // Verify in DB
      const row = await env.DB.prepare(`SELECT * FROM webhooks WHERE id = ?1`)
        .bind(data.webhook.id)
        .first();
      expect(row).not.toBeNull();
    });

    it("creates a webhook with custom label", async () => {
      const ctx = createExecutionContext();
      const res = await app.fetch(
        new Request("http://localhost/v1/webhooks", {
          method: "POST",
          headers: makeAuthHeaders(),
          body: JSON.stringify({ label: "My MacBook" }),
        }),
        env,
        ctx,
      );
      await waitOnExecutionContext(ctx);

      expect(res.status).toBe(201);
      const data = (await res.json()) as { webhook: { label: string } };
      expect(data.webhook.label).toBe("My MacBook");
    });

    it("truncates long labels to 100 chars", async () => {
      const ctx = createExecutionContext();
      const res = await app.fetch(
        new Request("http://localhost/v1/webhooks", {
          method: "POST",
          headers: makeAuthHeaders(),
          body: JSON.stringify({ label: "a".repeat(200) }),
        }),
        env,
        ctx,
      );
      await waitOnExecutionContext(ctx);

      expect(res.status).toBe(201);
      const data = (await res.json()) as { webhook: { label: string } };
      expect(data.webhook.label).toHaveLength(100);
    });
  });

  describe("GET /v1/webhooks/:id", () => {
    it("returns 404 when webhook not found", async () => {
      const ctx = createExecutionContext();
      const res = await app.fetch(
        new Request("http://localhost/v1/webhooks/nonexistent", {
          headers: makeAuthHeaders(),
        }),
        env,
        ctx,
      );
      await waitOnExecutionContext(ctx);

      expect(res.status).toBe(404);
    });

    it("returns 404 when webhook belongs to another user", async () => {
      const now = Date.now();
      await env.DB.prepare(
        `INSERT OR IGNORE INTO users (id, email, name, created_at) VALUES (?1, ?2, ?3, ?4)`,
      )
        .bind("other-user", "other@example.com", "Other", now)
        .run();

      await env.DB.prepare(
        `INSERT INTO webhooks (id, user_id, token, label, is_active, created_at)
         VALUES (?1, ?2, ?3, ?4, 1, ?5)`,
      )
        .bind("wh-other", "other-user", "tok-other", "Other", now)
        .run();

      const ctx = createExecutionContext();
      const res = await app.fetch(
        new Request("http://localhost/v1/webhooks/wh-other", {
          headers: makeAuthHeaders(),
        }),
        env,
        ctx,
      );
      await waitOnExecutionContext(ctx);

      expect(res.status).toBe(404);
    });

    it("returns webhook details", async () => {
      const now = Date.now();
      await env.DB.prepare(
        `INSERT INTO webhooks (id, user_id, token, label, is_active, created_at, last_used_at)
         VALUES (?1, ?2, ?3, ?4, 1, ?5, ?6)`,
      )
        .bind("wh-1", TEST_USER_ID, "tok-1", "My Webhook", now, now + 1000)
        .run();

      const ctx = createExecutionContext();
      const res = await app.fetch(
        new Request("http://localhost/v1/webhooks/wh-1", {
          headers: makeAuthHeaders(),
        }),
        env,
        ctx,
      );
      await waitOnExecutionContext(ctx);

      expect(res.status).toBe(200);
      const data = (await res.json()) as { webhook: { id: string; token: string; label: string } };
      expect(data.webhook.id).toBe("wh-1");
      expect(data.webhook.token).toBe("tok-1");
      expect(data.webhook.label).toBe("My Webhook");
    });
  });

  describe("PATCH /v1/webhooks/:id", () => {
    it("returns 404 when webhook not found", async () => {
      const ctx = createExecutionContext();
      const res = await app.fetch(
        new Request("http://localhost/v1/webhooks/nonexistent", {
          method: "PATCH",
          headers: makeAuthHeaders(),
          body: JSON.stringify({ label: "New" }),
        }),
        env,
        ctx,
      );
      await waitOnExecutionContext(ctx);

      expect(res.status).toBe(404);
    });

    it("returns 403 when webhook belongs to another user", async () => {
      const now = Date.now();
      await env.DB.prepare(
        `INSERT OR IGNORE INTO users (id, email, name, created_at) VALUES (?1, ?2, ?3, ?4)`,
      )
        .bind("other-user", "other@example.com", "Other", now)
        .run();

      await env.DB.prepare(
        `INSERT INTO webhooks (id, user_id, token, label, is_active, created_at)
         VALUES (?1, ?2, ?3, ?4, 1, ?5)`,
      )
        .bind("wh-other", "other-user", "tok-other", "Other", now)
        .run();

      const ctx = createExecutionContext();
      const res = await app.fetch(
        new Request("http://localhost/v1/webhooks/wh-other", {
          method: "PATCH",
          headers: makeAuthHeaders(),
          body: JSON.stringify({ label: "Hacked" }),
        }),
        env,
        ctx,
      );
      await waitOnExecutionContext(ctx);

      expect(res.status).toBe(403);
    });

    it("updates label", async () => {
      const now = Date.now();
      await env.DB.prepare(
        `INSERT INTO webhooks (id, user_id, token, label, is_active, created_at)
         VALUES (?1, ?2, ?3, ?4, 1, ?5)`,
      )
        .bind("wh-1", TEST_USER_ID, "tok-1", "Old Label", now)
        .run();

      const ctx = createExecutionContext();
      const res = await app.fetch(
        new Request("http://localhost/v1/webhooks/wh-1", {
          method: "PATCH",
          headers: makeAuthHeaders(),
          body: JSON.stringify({ label: "New Label" }),
        }),
        env,
        ctx,
      );
      await waitOnExecutionContext(ctx);

      expect(res.status).toBe(200);
      const data = (await res.json()) as { webhook: { label: string } };
      expect(data.webhook.label).toBe("New Label");
    });

    it("updates isActive", async () => {
      const now = Date.now();
      await env.DB.prepare(
        `INSERT INTO webhooks (id, user_id, token, label, is_active, created_at)
         VALUES (?1, ?2, ?3, ?4, 1, ?5)`,
      )
        .bind("wh-1", TEST_USER_ID, "tok-1", "Webhook", now)
        .run();

      const ctx = createExecutionContext();
      const res = await app.fetch(
        new Request("http://localhost/v1/webhooks/wh-1", {
          method: "PATCH",
          headers: makeAuthHeaders(),
          body: JSON.stringify({ isActive: false }),
        }),
        env,
        ctx,
      );
      await waitOnExecutionContext(ctx);

      expect(res.status).toBe(200);
      const data = (await res.json()) as { webhook: { isActive: boolean } };
      expect(data.webhook.isActive).toBe(false);
    });

    it("returns 400 when no valid fields provided", async () => {
      const now = Date.now();
      await env.DB.prepare(
        `INSERT INTO webhooks (id, user_id, token, label, is_active, created_at)
         VALUES (?1, ?2, ?3, ?4, 1, ?5)`,
      )
        .bind("wh-1", TEST_USER_ID, "tok-1", "Webhook", now)
        .run();

      const ctx = createExecutionContext();
      const res = await app.fetch(
        new Request("http://localhost/v1/webhooks/wh-1", {
          method: "PATCH",
          headers: makeAuthHeaders(),
          body: JSON.stringify({ unknown: "field" }),
        }),
        env,
        ctx,
      );
      await waitOnExecutionContext(ctx);

      expect(res.status).toBe(400);
    });
  });

  describe("DELETE /v1/webhooks/:id", () => {
    it("returns 404 when webhook not found", async () => {
      const ctx = createExecutionContext();
      const res = await app.fetch(
        new Request("http://localhost/v1/webhooks/nonexistent", {
          method: "DELETE",
          headers: makeAuthHeaders(),
        }),
        env,
        ctx,
      );
      await waitOnExecutionContext(ctx);

      expect(res.status).toBe(404);
    });

    it("returns 403 when webhook belongs to another user", async () => {
      const now = Date.now();
      await env.DB.prepare(
        `INSERT OR IGNORE INTO users (id, email, name, created_at) VALUES (?1, ?2, ?3, ?4)`,
      )
        .bind("other-user", "other@example.com", "Other", now)
        .run();

      await env.DB.prepare(
        `INSERT INTO webhooks (id, user_id, token, label, is_active, created_at)
         VALUES (?1, ?2, ?3, ?4, 1, ?5)`,
      )
        .bind("wh-other", "other-user", "tok-other", "Other", now)
        .run();

      const ctx = createExecutionContext();
      const res = await app.fetch(
        new Request("http://localhost/v1/webhooks/wh-other", {
          method: "DELETE",
          headers: makeAuthHeaders(),
        }),
        env,
        ctx,
      );
      await waitOnExecutionContext(ctx);

      expect(res.status).toBe(403);
    });

    it("deletes webhook", async () => {
      const now = Date.now();
      await env.DB.prepare(
        `INSERT INTO webhooks (id, user_id, token, label, is_active, created_at)
         VALUES (?1, ?2, ?3, ?4, 1, ?5)`,
      )
        .bind("wh-to-delete", TEST_USER_ID, "tok-1", "ToDelete", now)
        .run();

      // Verify exists
      const before = await env.DB.prepare(`SELECT id FROM webhooks WHERE id = ?1`)
        .bind("wh-to-delete")
        .first();
      expect(before).not.toBeNull();

      const ctx = createExecutionContext();
      const res = await app.fetch(
        new Request("http://localhost/v1/webhooks/wh-to-delete", {
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

      // Verify deleted
      const after = await env.DB.prepare(`SELECT id FROM webhooks WHERE id = ?1`)
        .bind("wh-to-delete")
        .first();
      expect(after).toBeNull();
    });
  });
});
