import { type NextRequest, NextResponse } from "next/server";
import { getAuthUser } from "@/lib/session";
import { query, queryFirst } from "@/lib/cf/d1";

interface SnapshotRow {
  id: string;
  user_id: string;
  webhook_id: string;
  hostname: string;
  platform: string;
  arch: string;
  username: string;
  collector_count: number;
  file_count: number;
  list_count: number;
  size_bytes: number;
  r2_key: string;
  snapshot_at: number;
  uploaded_at: number;
}

interface CountRow {
  total: number;
}

const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 100;

/**
 * GET /api/snapshots — list snapshots for the authenticated user.
 *
 * Query params:
 *  - limit  (default 20, max 100)
 *  - before (cursor: uploaded_at timestamp, for pagination)
 */
export async function GET(request: NextRequest) {
  const user = await getAuthUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // Parse query params
  const { searchParams } = request.nextUrl;

  let limit = DEFAULT_LIMIT;
  const limitParam = searchParams.get("limit");
  if (limitParam) {
    const parsed = parseInt(limitParam, 10);
    if (!Number.isNaN(parsed) && parsed > 0) {
      limit = Math.min(parsed, MAX_LIMIT);
    }
  }

  const beforeParam = searchParams.get("before");
  const before = beforeParam ? parseInt(beforeParam, 10) : null;

  // Build query
  let sql: string;
  let params: unknown[];

  if (before !== null && !Number.isNaN(before)) {
    sql = `SELECT id, hostname, platform, arch, username,
                  collector_count, file_count, list_count, size_bytes,
                  snapshot_at, uploaded_at
           FROM snapshots
           WHERE user_id = ?1 AND uploaded_at < ?2
           ORDER BY uploaded_at DESC
           LIMIT ?3`;
    params = [user.id, before, limit];
  } else {
    sql = `SELECT id, hostname, platform, arch, username,
                  collector_count, file_count, list_count, size_bytes,
                  snapshot_at, uploaded_at
           FROM snapshots
           WHERE user_id = ?1
           ORDER BY uploaded_at DESC
           LIMIT ?2`;
    params = [user.id, limit];
  }

  try {
    const rows = await query<SnapshotRow>(sql, params);

    // Get total count for the user
    const countRow = await queryFirst<CountRow>(
      `SELECT COUNT(*) as total FROM snapshots WHERE user_id = ?1`,
      [user.id],
    );
    const total = countRow?.total ?? 0;

    // Determine next cursor
    const lastRow = rows.length === limit ? rows[rows.length - 1] : null;
    const nextBefore = lastRow?.uploaded_at ?? null;

    const snapshots = rows.map((row) => ({
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
    }));

    return NextResponse.json({
      snapshots,
      total,
      nextBefore,
    });
  } catch (err) {
    console.error("GET /api/snapshots failed:", err);
    return NextResponse.json(
      { error: "Failed to fetch snapshots from database" },
      { status: 500 },
    );
  }
}
