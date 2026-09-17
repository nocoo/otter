// SnapshotRepo — SQL access for the `snapshots` D1 table, agnostic to whether
// the backing driver talks to D1 over HTTP (Node) or via a binding (worker).
//
// R2 I/O is intentionally NOT in this module. Callers handle blob storage:
//   - worker routes use c.env.SNAPSHOTS (R2Bucket binding) directly
//   - future code can introduce a parallel BlobDriver abstraction
import type { DbDriver } from "./db/driver";

// D1 row shape (snake_case columns).
export interface SnapshotRow {
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
  r2_key: string;
  // biome-ignore lint/style/useNamingConvention: D1 column name
  snapshot_at: number;
  // biome-ignore lint/style/useNamingConvention: D1 column name
  uploaded_at: number;
  // biome-ignore lint/style/useNamingConvention: D1 column name
  schema_version?: number;
  // biome-ignore lint/style/useNamingConvention: D1 column name
  device_id?: string | null;
  sha256?: string | null;
  // biome-ignore lint/style/useNamingConvention: D1 column name
  coverage_complete?: number | null;
  // biome-ignore lint/style/useNamingConvention: D1 column name
  summary_json?: string | null;
  // biome-ignore lint/style/useNamingConvention: query result column name
  latest_complete_id?: string | null;
}

export interface SnapshotMetadata {
  hostname: string | null;
  platform: string | null;
  arch: string | null;
  username: string | null;
  collectorCount: number;
  fileCount: number;
  listCount: number;
}

const SELECT_COLS = `id, user_id, hostname, platform, arch, username,
  collector_count, file_count, list_count, size_bytes, r2_key,
  snapshot_at, uploaded_at, schema_version, device_id, sha256, coverage_complete, summary_json`;

export interface ListOptions {
  limit?: number;
  before?: number | null;
  cursor?: string;
  device?: string;
  search?: string;
}

export interface ListResult {
  rows: SnapshotRow[];
  total: number;
  nextBefore: number | null;
  nextCursor: string | null;
}

export async function listSnapshots(
  driver: DbDriver,
  userId: string,
  options: ListOptions = {},
): Promise<ListResult> {
  const limit = Number.isFinite(options.limit)
    ? Math.min(Math.max(options.limit ?? 20, 1), 100)
    : 20;
  const before = options.before ?? null;
  const params: unknown[] = [userId];
  const conditions = ["user_id = ?1"];
  if (options.device) {
    params.push(options.device);
    conditions.push(`COALESCE(device_id, 'legacy:' || hostname) = ?${params.length}`);
  }
  if (options.search) {
    params.push(options.search);
    conditions.push(
      `(instr(lower(hostname), lower(?${params.length})) > 0 OR EXISTS (SELECT 1 FROM snapshot_search search WHERE search.user_id = snapshots.user_id AND search.snapshot_id = snapshots.id AND instr(lower(search.terms), lower(?${params.length})) > 0))`,
    );
  }
  const countParams = [...params];
  const countConditions = [...conditions];
  if (options.cursor) {
    const [time, id] = JSON.parse(options.cursor) as [number, string];
    if (!Number.isFinite(time) || typeof id !== "string") throw new Error("Invalid cursor");
    params.push(time, id);
    conditions.push(
      `(uploaded_at < ?${params.length - 1} OR (uploaded_at = ?${params.length - 1} AND id < ?${params.length}))`,
    );
  } else if (before) {
    params.push(before);
    conditions.push(`uploaded_at < ?${params.length}`);
  }
  params.push(limit);
  const sql = `SELECT ${SELECT_COLS} FROM snapshots
       WHERE ${conditions.join(" AND ")}
       ORDER BY uploaded_at DESC, id DESC LIMIT ?${params.length}`;
  const [rows, countRow] = await Promise.all([
    driver.query<SnapshotRow>(sql, params),
    driver.queryFirst<{ total: number }>(
      `SELECT COUNT(*) as total FROM snapshots WHERE ${countConditions.join(" AND ")}`,
      countParams,
    ),
  ]);
  const last = rows[rows.length - 1];
  const nextBefore = rows.length === limit ? (last?.uploaded_at ?? null) : null;
  const nextCursor =
    rows.length === limit && last ? JSON.stringify([last.uploaded_at, last.id]) : null;

  return { rows, total: countRow?.total ?? 0, nextBefore, nextCursor };
}

export function getSnapshotMeta(
  driver: DbDriver,
  userId: string,
  snapshotId: string,
): Promise<SnapshotRow | null> {
  return driver.queryFirst<SnapshotRow>(
    `SELECT ${SELECT_COLS} FROM snapshots WHERE id = ?1 AND user_id = ?2`,
    [snapshotId, userId],
  );
}

export async function snapshotExists(
  driver: DbDriver,
  userId: string,
  snapshotId: string,
): Promise<boolean> {
  const row = await driver.queryFirst<{ id: string }>(
    "SELECT id FROM snapshots WHERE id = ?1 AND user_id = ?2",
    [snapshotId, userId],
  );
  return row !== null;
}

export async function deleteSnapshotMeta(
  driver: DbDriver,
  snapshotId: string,
  userId: string,
): Promise<void> {
  await driver.execute("DELETE FROM snapshots WHERE id = ?1 AND user_id = ?2", [
    snapshotId,
    userId,
  ]);
}

export interface InsertSnapshotInput {
  id: string;
  userId: string;
  /** Webhook row id when uploaded via /ingest/:token, or null for Bearer uploads. */
  webhookId: string | null;
  meta: SnapshotMetadata;
  sizeBytes: number;
  r2Key: string;
  snapshotAt: number;
  uploadedAt: number;
  schemaVersion?: number;
  deviceId?: string;
  sha256?: string;
  complete?: boolean;
  summary?: unknown;
}

export function insertSnapshotStatement(input: InsertSnapshotInput): {
  sql: string;
  params: unknown[];
} {
  return {
    sql: `INSERT INTO snapshots (
        id, user_id, webhook_id, hostname, platform, arch, username,
        collector_count, file_count, list_count, size_bytes, r2_key,
        snapshot_at, uploaded_at, schema_version, device_id, sha256, coverage_complete, summary_json
      ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16, ?17, ?18, ?19)
      ON CONFLICT(user_id, id) DO NOTHING`,
    params: [
      input.id,
      input.userId,
      input.webhookId,
      input.meta.hostname,
      input.meta.platform,
      input.meta.arch,
      input.meta.username,
      input.meta.collectorCount,
      input.meta.fileCount,
      input.meta.listCount,
      input.sizeBytes,
      input.r2Key,
      input.snapshotAt,
      input.uploadedAt,
      input.schemaVersion ?? 1,
      input.deviceId ?? null,
      input.sha256 ?? null,
      input.complete === undefined ? null : Number(input.complete),
      input.summary ? JSON.stringify(input.summary) : null,
    ],
  };
}

export function snapshotR2Key(userId: string, snapshotId: string): string {
  return `${userId}/${snapshotId}.json`;
}

export function listDevices(driver: DbDriver, userId: string): Promise<SnapshotRow[]> {
  return driver.query<SnapshotRow>(
    `WITH ranked AS (
    SELECT *, ROW_NUMBER() OVER (PARTITION BY COALESCE(device_id, 'legacy:' || hostname) ORDER BY snapshot_at DESC, uploaded_at DESC, id DESC) AS position
    FROM snapshots WHERE user_id = ?1
  ) SELECT *, (SELECT id FROM snapshots complete WHERE complete.user_id = ranked.user_id
    AND COALESCE(complete.device_id, 'legacy:' || complete.hostname) = COALESCE(ranked.device_id, 'legacy:' || ranked.hostname)
    AND coverage_complete = 1 ORDER BY snapshot_at DESC, uploaded_at DESC, id DESC LIMIT 1) AS latest_complete_id
  FROM ranked WHERE position = 1 ORDER BY snapshot_at DESC`,
    [userId],
  );
}
