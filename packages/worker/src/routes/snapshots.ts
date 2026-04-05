import { Hono } from "hono";
import { deleteSnapshot, getSnapshot, snapshotKey } from "../services/snapshot.js";
import type { Env, Variables } from "../types.js";

// biome-ignore lint/style/useNamingConvention: Hono generic parameter names
const app = new Hono<{ Bindings: Env; Variables: Variables }>();

// ---------------------------------------------------------------------------
// Types (D1 column names use snake_case)
// ---------------------------------------------------------------------------

interface SnapshotRow {
  id: string;
  // biome-ignore lint/style/useNamingConvention: D1 column name
  user_id: string;
  hostname: string | null;
  platform: string | null;
  arch: string | null;
  username: string | null;
  // biome-ignore lint/style/useNamingConvention: D1 column name
  collector_count: number;
  // biome-ignore lint/style/useNamingConvention: D1 column name
  file_count: number;
  // biome-ignore lint/style/useNamingConvention: D1 column name
  list_count: number;
  // biome-ignore lint/style/useNamingConvention: D1 column name
  size_bytes: number;
  // biome-ignore lint/style/useNamingConvention: D1 column name
  snapshot_at: number;
  // biome-ignore lint/style/useNamingConvention: D1 column name
  uploaded_at: number;
}

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

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// GET /v1/snapshots - List snapshots with cursor-based pagination
// ---------------------------------------------------------------------------

app.get("/", async (c) => {
  const userId = c.get("userId");
  const db = c.env.DB;

  // Parse query params
  const limitParam = c.req.query("limit");
  const beforeParam = c.req.query("before");

  const limit = Math.min(Math.max(Number(limitParam) || 20, 1), 100);
  const before = beforeParam ? Number(beforeParam) : null;

  // Build query
  let query: string;
  let params: (string | number)[];

  if (before) {
    query = `
      SELECT id, user_id, hostname, platform, arch, username,
             collector_count, file_count, list_count, size_bytes,
             snapshot_at, uploaded_at
      FROM snapshots
      WHERE user_id = ?1 AND uploaded_at < ?2
      ORDER BY uploaded_at DESC
      LIMIT ?3
    `;
    params = [userId, before, limit];
  } else {
    query = `
      SELECT id, user_id, hostname, platform, arch, username,
             collector_count, file_count, list_count, size_bytes,
             snapshot_at, uploaded_at
      FROM snapshots
      WHERE user_id = ?1
      ORDER BY uploaded_at DESC
      LIMIT ?2
    `;
    params = [userId, limit];
  }

  // Execute queries in parallel
  const [rowsResult, countResult] = await Promise.all([
    db
      .prepare(query)
      .bind(...params)
      .all<SnapshotRow>(),
    db
      .prepare("SELECT COUNT(*) as total FROM snapshots WHERE user_id = ?1")
      .bind(userId)
      .first<{ total: number }>(),
  ]);

  const rows = rowsResult.results ?? [];
  const total = countResult?.total ?? 0;

  // Determine next cursor
  const lastRow = rows[rows.length - 1];
  const nextBefore = rows.length === limit ? (lastRow?.uploaded_at ?? null) : null;

  return c.json({
    snapshots: rows.map(toSnapshotResponse),
    total,
    nextBefore,
  });
});

// ---------------------------------------------------------------------------
// GET /v1/snapshots/:id - Get snapshot detail with full R2 data
// ---------------------------------------------------------------------------

app.get("/:id", async (c) => {
  const userId = c.get("userId");
  const snapshotId = c.req.param("id");
  const db = c.env.DB;
  const bucket = c.env.SNAPSHOTS;

  // Fetch metadata from D1
  const row = await db
    .prepare(
      `SELECT id, user_id, hostname, platform, arch, username,
              collector_count, file_count, list_count, size_bytes,
              snapshot_at, uploaded_at
       FROM snapshots
       WHERE id = ?1 AND user_id = ?2`,
    )
    .bind(snapshotId, userId)
    .first<SnapshotRow>();

  if (!row) {
    return c.json({ error: "Snapshot not found" }, 404);
  }

  // Fetch full data from R2
  const key = snapshotKey(userId, snapshotId);
  const data = await getSnapshot(bucket, key);

  if (!data) {
    return c.json({ error: "Snapshot data not found in storage" }, 404);
  }

  return c.json({
    snapshot: toSnapshotResponse(row),
    data,
  });
});

// ---------------------------------------------------------------------------
// DELETE /v1/snapshots/:id - Delete snapshot from D1 and R2
// ---------------------------------------------------------------------------

app.delete("/:id", async (c) => {
  const userId = c.get("userId");
  const snapshotId = c.req.param("id");
  const db = c.env.DB;
  const bucket = c.env.SNAPSHOTS;

  // Verify ownership
  const row = await db
    .prepare("SELECT id FROM snapshots WHERE id = ?1 AND user_id = ?2")
    .bind(snapshotId, userId)
    .first<{ id: string }>();

  if (!row) {
    return c.json({ error: "Snapshot not found" }, 404);
  }

  // Delete from R2 first, then D1
  const key = snapshotKey(userId, snapshotId);
  await deleteSnapshot(bucket, key);

  await db.prepare("DELETE FROM snapshots WHERE id = ?1").bind(snapshotId).run();

  return c.json({ success: true });
});

export { app as snapshotsRoutes };
