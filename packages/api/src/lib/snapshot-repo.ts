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
  snapshot_at, uploaded_at`;

export interface ListOptions {
  limit?: number;
  before?: number | null;
}

export interface ListResult {
  rows: SnapshotRow[];
  total: number;
  nextBefore: number | null;
}

export async function listSnapshots(
  driver: DbDriver,
  userId: string,
  options: ListOptions = {},
): Promise<ListResult> {
  const limit = Math.min(Math.max(options.limit ?? 20, 1), 100);
  const before = options.before ?? null;

  const sql = before
    ? `SELECT ${SELECT_COLS} FROM snapshots
       WHERE user_id = ?1 AND uploaded_at < ?2
       ORDER BY uploaded_at DESC LIMIT ?3`
    : `SELECT ${SELECT_COLS} FROM snapshots
       WHERE user_id = ?1
       ORDER BY uploaded_at DESC LIMIT ?2`;
  const params = before ? [userId, before, limit] : [userId, limit];

  const [rows, countRow] = await Promise.all([
    driver.query<SnapshotRow>(sql, params),
    driver.queryFirst<{ total: number }>(
      "SELECT COUNT(*) as total FROM snapshots WHERE user_id = ?1",
      [userId],
    ),
  ]);

  const last = rows[rows.length - 1];
  const nextBefore = rows.length === limit ? (last?.uploaded_at ?? null) : null;

  return { rows, total: countRow?.total ?? 0, nextBefore };
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

export async function deleteSnapshotMeta(driver: DbDriver, snapshotId: string): Promise<void> {
  await driver.execute("DELETE FROM snapshots WHERE id = ?1", [snapshotId]);
}

export interface InsertSnapshotInput {
  id: string;
  userId: string;
  webhookId: string;
  meta: SnapshotMetadata;
  sizeBytes: number;
  r2Key: string;
  snapshotAt: number;
  uploadedAt: number;
}

export function insertSnapshotStatement(input: InsertSnapshotInput): {
  sql: string;
  params: unknown[];
} {
  return {
    sql: `INSERT INTO snapshots (
        id, user_id, webhook_id, hostname, platform, arch, username,
        collector_count, file_count, list_count, size_bytes, r2_key,
        snapshot_at, uploaded_at
      ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14)`,
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
    ],
  };
}

export function snapshotR2Key(userId: string, snapshotId: string): string {
  return `${userId}/${snapshotId}.json`;
}
