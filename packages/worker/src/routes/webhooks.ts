import { Hono } from "hono";
import type { Env, Variables } from "../types.js";

// biome-ignore lint/style/useNamingConvention: Hono generic parameter names
const app = new Hono<{ Bindings: Env; Variables: Variables }>();

// ---------------------------------------------------------------------------
// Types (D1 column names use snake_case)
// ---------------------------------------------------------------------------

interface WebhookRow {
  id: string;
  // biome-ignore lint/style/useNamingConvention: D1 column name
  user_id: string;
  token: string;
  label: string;
  // biome-ignore lint/style/useNamingConvention: D1 column name
  is_active: number;
  // biome-ignore lint/style/useNamingConvention: D1 column name
  created_at: number;
  // biome-ignore lint/style/useNamingConvention: D1 column name
  last_used_at: number | null;
}

interface WebhookResponse {
  id: string;
  token: string;
  label: string;
  isActive: boolean;
  createdAt: number;
  lastUsedAt: number | null;
}

interface OwnershipRow {
  id: string;
  // biome-ignore lint/style/useNamingConvention: D1 column name
  user_id: string;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function toWebhookResponse(row: WebhookRow): WebhookResponse {
  return {
    id: row.id,
    token: row.token,
    label: row.label,
    isActive: row.is_active === 1,
    createdAt: row.created_at,
    lastUsedAt: row.last_used_at,
  };
}

// ---------------------------------------------------------------------------
// GET /v1/webhooks - List all webhooks for user
// ---------------------------------------------------------------------------

app.get("/", async (c) => {
  const userId = c.get("userId");
  const db = c.env.DB;

  const result = await db
    .prepare(
      `SELECT id, user_id, token, label, is_active, created_at, last_used_at
       FROM webhooks
       WHERE user_id = ?1
       ORDER BY created_at DESC`,
    )
    .bind(userId)
    .all<WebhookRow>();

  const webhooks = (result.results ?? []).map(toWebhookResponse);

  return c.json({ webhooks });
});

// ---------------------------------------------------------------------------
// POST /v1/webhooks - Create a new webhook
// ---------------------------------------------------------------------------

app.post("/", async (c) => {
  const userId = c.get("userId");
  const db = c.env.DB;

  // Parse body
  let label = "Default";
  try {
    const body = await c.req.json<{ label?: string }>();
    if (body.label && typeof body.label === "string") {
      label = body.label.trim().slice(0, 100) || "Default";
    }
  } catch {
    // No body or invalid JSON — use default label
  }

  const id = crypto.randomUUID();
  const token = crypto.randomUUID();
  const now = Date.now();

  await db
    .prepare(
      `INSERT INTO webhooks (id, user_id, token, label, is_active, created_at, last_used_at)
       VALUES (?1, ?2, ?3, ?4, 1, ?5, NULL)`,
    )
    .bind(id, userId, token, label, now)
    .run();

  return c.json(
    {
      webhook: {
        id,
        token,
        label,
        isActive: true,
        createdAt: now,
        lastUsedAt: null,
      },
    },
    201,
  );
});

// ---------------------------------------------------------------------------
// GET /v1/webhooks/:id - Get single webhook
// ---------------------------------------------------------------------------

app.get("/:id", async (c) => {
  const userId = c.get("userId");
  const webhookId = c.req.param("id");
  const db = c.env.DB;

  const row = await db
    .prepare(
      `SELECT id, user_id, token, label, is_active, created_at, last_used_at
       FROM webhooks
       WHERE id = ?1 AND user_id = ?2`,
    )
    .bind(webhookId, userId)
    .first<WebhookRow>();

  if (!row) {
    return c.json({ error: "Webhook not found" }, 404);
  }

  return c.json({ webhook: toWebhookResponse(row) });
});

// ---------------------------------------------------------------------------
// PATCH /v1/webhooks/:id - Update webhook (label, isActive)
// ---------------------------------------------------------------------------

app.patch("/:id", async (c) => {
  const userId = c.get("userId");
  const webhookId = c.req.param("id");
  const db = c.env.DB;

  // Verify ownership
  const existing = await db
    .prepare("SELECT id, user_id FROM webhooks WHERE id = ?1")
    .bind(webhookId)
    .first<OwnershipRow>();

  if (!existing) {
    return c.json({ error: "Webhook not found" }, 404);
  }

  if (existing.user_id !== userId) {
    return c.json({ error: "Forbidden" }, 403);
  }

  // Parse body
  let body: { label?: string; isActive?: boolean };
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: "Invalid JSON body" }, 400);
  }

  // Build dynamic update
  const updates: string[] = [];
  const values: (string | number)[] = [];
  let paramIndex = 1;

  if (typeof body.label === "string") {
    updates.push(`label = ?${paramIndex++}`);
    values.push(body.label.trim().slice(0, 100) || "Default");
  }

  if (typeof body.isActive === "boolean") {
    updates.push(`is_active = ?${paramIndex++}`);
    values.push(body.isActive ? 1 : 0);
  }

  if (updates.length === 0) {
    return c.json({ error: "No valid fields to update" }, 400);
  }

  // Execute update
  values.push(webhookId);
  await db
    .prepare(`UPDATE webhooks SET ${updates.join(", ")} WHERE id = ?${paramIndex}`)
    .bind(...values)
    .run();

  // Fetch updated row
  const updated = await db
    .prepare(
      `SELECT id, user_id, token, label, is_active, created_at, last_used_at
       FROM webhooks
       WHERE id = ?1`,
    )
    .bind(webhookId)
    .first<WebhookRow>();

  if (!updated) {
    return c.json({ error: "Failed to fetch updated webhook" }, 500);
  }

  return c.json({ webhook: toWebhookResponse(updated) });
});

// ---------------------------------------------------------------------------
// DELETE /v1/webhooks/:id - Delete webhook
// ---------------------------------------------------------------------------

app.delete("/:id", async (c) => {
  const userId = c.get("userId");
  const webhookId = c.req.param("id");
  const db = c.env.DB;

  // Verify ownership
  const existing = await db
    .prepare("SELECT id, user_id FROM webhooks WHERE id = ?1")
    .bind(webhookId)
    .first<OwnershipRow>();

  if (!existing) {
    return c.json({ error: "Webhook not found" }, 404);
  }

  if (existing.user_id !== userId) {
    return c.json({ error: "Forbidden" }, 403);
  }

  // Delete
  await db.prepare("DELETE FROM webhooks WHERE id = ?1").bind(webhookId).run();

  return c.json({ success: true });
});

export { app as webhooksRoutes };
