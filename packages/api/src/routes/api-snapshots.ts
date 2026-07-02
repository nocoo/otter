// /api/snapshots — D1-binding-backed snapshot routes for the Vite SPA
// (list/get/delete) and the CLI (upload via POST + Bearer token).
//
// Authenticated via `accessEmail` populated by accessAuth (CF Access JWT) or
// apiKeyAuth (Bearer token). R2 bucket is injected via opts so the same factory
// works for both the production worker (R2 binding) and unit tests (fake bucket).

import { type Context, Hono } from "hono";
import type { AppEnv } from "../lib/app-env";
import type { DbDriver } from "../lib/db/driver";
import { readMaybeGzip } from "../lib/gzip";
import type { R2BucketLike } from "../lib/r2";
import {
  extractSnapshotMetadata,
  isValidSnapshotPayload,
  type SnapshotPayload,
} from "../lib/snapshot-payload";
import {
  deleteSnapshotMeta,
  getSnapshotMeta,
  insertSnapshotStatement,
  listSnapshots,
  type SnapshotRow,
  snapshotR2Key,
} from "../lib/snapshot-repo";

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
  getBucket: (c: Context<AppEnv>) => R2BucketLike;
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

  app.post("/", async (c) => {
    const auth = requireUser(c);
    if (auth instanceof Response) return auth;

    const { json: jsonString, error: decompressError } = await readMaybeGzip(c.req.raw);
    if (decompressError) return c.json({ error: decompressError }, 400);

    let snapshot: SnapshotPayload;
    try {
      const parsed: unknown = JSON.parse(jsonString);
      if (!isValidSnapshotPayload(parsed)) {
        return c.json({ error: "Invalid snapshot format" }, 400);
      }
      snapshot = parsed;
    } catch {
      return c.json({ error: "Invalid JSON body" }, 400);
    }

    const meta = extractSnapshotMetadata(snapshot);
    const sizeBytes = new TextEncoder().encode(jsonString).length;
    const r2Key = snapshotR2Key(auth.email, snapshot.id);

    try {
      await opts.getBucket(c).put(r2Key, jsonString, {
        httpMetadata: { contentType: "application/json" },
      });
    } catch (error) {
      console.error("[api/snapshots] Failed to store snapshot in R2:", error);
      return c.json({ error: "Failed to store snapshot" }, 500);
    }

    const now = Date.now();
    const snapshotAt = new Date(snapshot.createdAt).getTime();
    const insert = insertSnapshotStatement({
      id: snapshot.id,
      userId: auth.email,
      webhookId: null,
      meta,
      sizeBytes,
      r2Key,
      snapshotAt,
      uploadedAt: now,
    });

    try {
      await opts.getDriver(c).execute(insert.sql, insert.params);
    } catch (error) {
      console.error("[api/snapshots] Failed to write snapshot metadata to D1:", error);
      return c.json({ error: "Failed to index snapshot" }, 500);
    }

    return c.json({ success: true, snapshotId: snapshot.id }, 201);
  });

  app.get("/:id", async (c) => {
    const auth = requireUser(c);
    if (auth instanceof Response) return auth;
    const id = c.req.param("id");
    const driver = opts.getDriver(c);
    const row = await getSnapshotMeta(driver, auth.email, id);
    if (!row) return c.json({ error: "Snapshot not found" }, 404);
    const object = await opts.getBucket(c).get(row.r2_key);
    if (!object) return c.json({ error: "Snapshot data not found in storage" }, 404);
    const data = JSON.parse(await object.text());
    return c.json({ snapshot: toSnapshotResponse(row), data });
  });

  app.delete("/:id", async (c) => {
    const auth = requireUser(c);
    if (auth instanceof Response) return auth;
    const id = c.req.param("id");
    const driver = opts.getDriver(c);
    const row = await getSnapshotMeta(driver, auth.email, id);
    if (!row) return c.json({ error: "Snapshot not found" }, 404);
    await opts.getBucket(c).delete(row.r2_key);
    await deleteSnapshotMeta(driver, id);
    return c.json({ success: true });
  });

  return app;
}
