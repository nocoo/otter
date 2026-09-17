import {
  isValidSnapshotPayload,
  readMaybeGzip,
  SnapshotWriteError,
  storeSnapshot,
  validateSnapshotContents,
} from "@otter/api";
import { createBindingDriver } from "@otter/api/lib/db/d1-binding";
import { Hono } from "hono";
import { validateWebhookToken } from "../services/webhook.js";
import type { Env, Variables } from "../types.js";

// biome-ignore lint/style/useNamingConvention: Hono generic parameter names
export const ingestRoutes = new Hono<{ Bindings: Env; Variables: Variables }>();

interface WebhookRow {
  id: string;
  // biome-ignore lint/style/useNamingConvention: D1 column name
  user_id: string;
  token: string;
  // biome-ignore lint/style/useNamingConvention: D1 column name
  is_active: number;
}

/**
 * POST /ingest/{token} — receive CLI snapshot uploads
 */
ingestRoutes.post("/:token", async (c) => {
  const token = c.req.param("token");

  // 1. Validate webhook token
  const webhook = await validateWebhookToken<WebhookRow>(c.env.DB, token);

  if (!webhook) {
    return c.json({ error: "Invalid webhook token" }, 401);
  }

  if (webhook.is_active !== 1) {
    return c.json({ error: "Webhook is disabled" }, 403);
  }

  // 2. Read and decompress the body
  const { json: jsonString, error: decompressError } = await readMaybeGzip(c.req.raw);
  if (decompressError) {
    return c.json({ error: decompressError }, 400);
  }

  // 3. Parse and validate JSON
  let snapshot: Parameters<typeof storeSnapshot>[3];
  try {
    const parsed: unknown = JSON.parse(jsonString);
    if (!isValidSnapshotPayload(parsed) || !(await validateSnapshotContents(parsed))) {
      return c.json({ error: "Invalid snapshot format" }, 400);
    }
    snapshot = parsed;
  } catch {
    return c.json({ error: "Invalid JSON body" }, 400);
  }

  try {
    const stored = await storeSnapshot(
      createBindingDriver(c.env.DB),
      c.env.SNAPSHOTS,
      webhook.user_id,
      snapshot,
      webhook.id,
    );
    return c.json(
      { success: true, snapshotId: snapshot.id, receipt: stored.receipt },
      stored.created ? 201 : 200,
    );
  } catch (error) {
    return c.json(
      { error: error instanceof Error ? error.message : "Snapshot upload failed" },
      error instanceof SnapshotWriteError ? error.status : 500,
    );
  }
});
