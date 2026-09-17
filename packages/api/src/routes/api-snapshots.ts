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
  isValidSnapshotPayload,
  type SnapshotPayload,
  sha256,
  validateSnapshotContents,
} from "../lib/snapshot-payload";
import {
  deleteSnapshotMeta,
  getSnapshotMeta,
  type ListOptions,
  listDevices,
  listSnapshots,
  type SnapshotRow,
} from "../lib/snapshot-repo";
import { SnapshotWriteError, storeSnapshot } from "../lib/snapshot-storage";

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
  schemaVersion: number;
  deviceId: string | null;
  complete: boolean | null;
  sha256: string | null;
  summary: unknown;
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
    schemaVersion: row.schema_version ?? 1,
    deviceId: row.device_id ?? null,
    complete: row.coverage_complete == null ? null : row.coverage_complete === 1,
    sha256: row.sha256 ?? null,
    summary: row.summary_json ? JSON.parse(row.summary_json) : null,
  };
}

function requireUser(c: Context<AppEnv>): { email: string } | Response {
  const email = c.get("accessEmail");
  if (!email) return c.json({ error: "Unauthorized" }, 401);
  return { email };
}

function validCursor(cursor: string): boolean {
  try {
    const value: unknown = JSON.parse(cursor);
    return (
      Array.isArray(value) &&
      value.length === 2 &&
      typeof value[0] === "number" &&
      Number.isFinite(value[0]) &&
      typeof value[1] === "string"
    );
  } catch {
    return false;
  }
}
async function parseSnapshotBody(request: Request): Promise<SnapshotPayload | string> {
  const { json, error } = await readMaybeGzip(request);
  if (error) return error;
  try {
    const parsed: unknown = JSON.parse(json);
    if (!isValidSnapshotPayload(parsed) || !(await validateSnapshotContents(parsed)))
      return "Invalid snapshot format";
    return parsed;
  } catch {
    return "Invalid JSON body";
  }
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
    const listOpts: ListOptions = {};
    const cursor = c.req.query("cursor"),
      device = c.req.query("device"),
      search = c.req.query("search");
    if (cursor && !validCursor(cursor)) return c.json({ error: "Invalid cursor" }, 400);
    if (cursor) listOpts.cursor = cursor;
    if (device) listOpts.device = device;
    if (search) listOpts.search = search.slice(0, 200);
    if (limitParam) listOpts.limit = Number.parseInt(limitParam, 10);
    if (beforeParam) listOpts.before = Number.parseInt(beforeParam, 10);
    const result = await listSnapshots(opts.getDriver(c), auth.email, listOpts);
    return c.json({
      snapshots: result.rows.map(toSnapshotResponse),
      total: result.total,
      nextBefore: result.nextBefore,
      nextCursor: result.nextCursor,
    });
  });

  app.get("/devices", async (c) => {
    const auth = requireUser(c);
    if (auth instanceof Response) return auth;
    const rows = await listDevices(opts.getDriver(c), auth.email);
    return c.json({
      devices: rows.map((row) => ({
        ...toSnapshotResponse(row),
        deviceKey: row.device_id ?? `legacy:${row.hostname}`,
        latestCompleteId: row.latest_complete_id ?? null,
      })),
    });
  });

  app.post("/", async (c) => {
    const auth = requireUser(c);
    if (auth instanceof Response) return auth;

    const snapshot = await parseSnapshotBody(c.req.raw);
    if (typeof snapshot === "string") return c.json({ error: snapshot }, 400);

    try {
      const stored = await storeSnapshot(
        opts.getDriver(c),
        opts.getBucket(c),
        auth.email,
        snapshot,
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
    const digest = await sha256(JSON.stringify(data));
    if (row.sha256 && row.sha256 !== digest)
      return c.json({ error: "Stored snapshot digest mismatch" }, 500);
    return c.json({
      snapshot: toSnapshotResponse(row),
      data,
      receipt: {
        snapshotId: row.id,
        sha256: digest,
        account: auth.email,
        receivedAt: new Date(row.uploaded_at).toISOString(),
      },
    });
  });

  app.delete("/:id", async (c) => {
    const auth = requireUser(c);
    if (auth instanceof Response) return auth;
    const id = c.req.param("id");
    const driver = opts.getDriver(c);
    const row = await getSnapshotMeta(driver, auth.email, id);
    if (!row) return c.json({ error: "Snapshot not found" }, 404);
    await opts.getBucket(c).delete(row.r2_key);
    await deleteSnapshotMeta(driver, id, auth.email);
    return c.json({ success: true });
  });

  return app;
}
