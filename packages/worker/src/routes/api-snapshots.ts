// /api/snapshots and /api/webhooks — new routes for the Vite SPA.
// Authenticated via accessEmail (CF Access JWT or Bearer token), uses
// snapshot-repo / webhook-repo against the D1 binding driver. R2 I/O for
// snapshot bodies stays in this worker (binding access).

import type { AppEnv } from "@otter/api/lib/app-env";
import type { DbDriver } from "@otter/api/lib/db/driver";
import {
  deleteSnapshotMeta,
  getSnapshotMeta,
  listSnapshots,
  type SnapshotRow,
  snapshotR2Key,
} from "@otter/api/lib/snapshot-repo";
import {
  createWebhook,
  deleteWebhook,
  getWebhookByIdForUser,
  getWebhookOwnership,
  listWebhooks,
  type UpdateWebhookInput,
  updateWebhook,
} from "@otter/api/lib/webhook-repo";
import { type Context, Hono } from "hono";
import {
  deleteSnapshot as deleteSnapshotBlob,
  getSnapshot as getSnapshotBlob,
} from "../services/snapshot.js";

interface SnapshotResponse {
  id: string;
  hostname: string | null;
  platform: string | null;
  arch: string | null;
  username: string | null;
  collectorCount: number;
  fileCount: number;
  listCount: number;
  sizeBytes: number;
  snapshotAt: number;
  uploadedAt: number;
}

function toSnapshotResponse(row: SnapshotRow): SnapshotResponse {
  return {
    id: row.id,
    hostname: row.hostname,
    platform: row.platform,
    arch: row.arch,
    username: row.username,
    collectorCount: row.collector_count,
    fileCount: row.file_count,
    listCount: row.list_count,
    sizeBytes: row.size_bytes,
    snapshotAt: row.snapshot_at,
    uploadedAt: row.uploaded_at,
  };
}

function requireUser(c: Context<AppEnv>): { email: string } | Response {
  const email = c.get("accessEmail");
  if (!email) return c.json({ error: "Unauthorized" }, 401);
  return { email };
}

export interface SnapshotsRouteOptions {
  getDriver: (c: Context<AppEnv>) => DbDriver;
  getBucket: (c: Context<AppEnv>) => R2Bucket;
}

export function createApiSnapshotsRoute(opts: SnapshotsRouteOptions) {
  const app = new Hono<AppEnv>();

  app.get("/", async (c) => {
    const auth = requireUser(c);
    if (auth instanceof Response) return auth;
    const limitParam = c.req.query("limit");
    const beforeParam = c.req.query("before");
    const listOpts: { limit?: number; before?: number | null } = {};
    if (limitParam) listOpts.limit = Number.parseInt(limitParam, 10);
    if (beforeParam) listOpts.before = Number.parseInt(beforeParam, 10);
    const result = await listSnapshots(opts.getDriver(c), auth.email, listOpts);
    return c.json({
      snapshots: result.rows.map(toSnapshotResponse),
      total: result.total,
      nextBefore: result.nextBefore,
    });
  });

  app.get("/:id", async (c) => {
    const auth = requireUser(c);
    if (auth instanceof Response) return auth;
    const id = c.req.param("id");
    const driver = opts.getDriver(c);
    const row = await getSnapshotMeta(driver, auth.email, id);
    if (!row) return c.json({ error: "Snapshot not found" }, 404);
    const data = await getSnapshotBlob(opts.getBucket(c), snapshotR2Key(auth.email, id));
    if (!data) return c.json({ error: "Snapshot data not found in storage" }, 404);
    return c.json({ snapshot: toSnapshotResponse(row), data });
  });

  app.delete("/:id", async (c) => {
    const auth = requireUser(c);
    if (auth instanceof Response) return auth;
    const id = c.req.param("id");
    const driver = opts.getDriver(c);
    const row = await getSnapshotMeta(driver, auth.email, id);
    if (!row) return c.json({ error: "Snapshot not found" }, 404);
    await deleteSnapshotBlob(opts.getBucket(c), snapshotR2Key(auth.email, id));
    await deleteSnapshotMeta(driver, id);
    return c.json({ success: true });
  });

  return app;
}

export interface WebhooksRouteOptions {
  getDriver: (c: Context<AppEnv>) => DbDriver;
}

const TOKEN_RE = /\+/g;
const SLASH_RE = /\//g;
const TRAILING_EQ_RE = /=+$/;

function generateWebhookToken(): string {
  const bytes = new Uint8Array(24);
  crypto.getRandomValues(bytes);
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(TOKEN_RE, "-").replace(SLASH_RE, "_").replace(TRAILING_EQ_RE, "");
}

export function createApiWebhooksRoute(opts: WebhooksRouteOptions) {
  const app = new Hono<AppEnv>();

  app.get("/", async (c) => {
    const auth = requireUser(c);
    if (auth instanceof Response) return auth;
    const rows = await listWebhooks(opts.getDriver(c), auth.email);
    return c.json({ webhooks: rows });
  });

  app.post("/", async (c) => {
    const auth = requireUser(c);
    if (auth instanceof Response) return auth;
    const body = (await c.req.json().catch(() => ({}))) as { label?: string };
    const created = await createWebhook(opts.getDriver(c), {
      id: crypto.randomUUID(),
      userId: auth.email,
      token: generateWebhookToken(),
      label: body.label ?? "default",
      createdAt: Date.now(),
    });
    return c.json({ webhook: created });
  });

  app.get("/:id", async (c) => {
    const auth = requireUser(c);
    if (auth instanceof Response) return auth;
    const row = await getWebhookByIdForUser(opts.getDriver(c), auth.email, c.req.param("id"));
    if (!row) return c.json({ error: "Webhook not found" }, 404);
    return c.json({ webhook: row });
  });

  app.patch("/:id", async (c) => {
    const auth = requireUser(c);
    if (auth instanceof Response) return auth;
    const id = c.req.param("id");
    const driver = opts.getDriver(c);
    const owner = await getWebhookOwnership(driver, id);
    if (!owner || owner.user_id !== auth.email) return c.json({ error: "Webhook not found" }, 404);
    const body = (await c.req.json().catch(() => ({}))) as UpdateWebhookInput;
    const updated = await updateWebhook(driver, id, body);
    return c.json({ webhook: updated });
  });

  app.delete("/:id", async (c) => {
    const auth = requireUser(c);
    if (auth instanceof Response) return auth;
    const id = c.req.param("id");
    const driver = opts.getDriver(c);
    const owner = await getWebhookOwnership(driver, id);
    if (!owner || owner.user_id !== auth.email) return c.json({ error: "Webhook not found" }, 404);
    await deleteWebhook(driver, id);
    return c.json({ success: true });
  });

  return app;
}
