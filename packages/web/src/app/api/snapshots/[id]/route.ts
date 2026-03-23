import { NextResponse } from "next/server";
import { queryFirst } from "@/lib/cf/d1";
import { getSnapshot, snapshotKey } from "@/lib/cf/r2";
import { getAuthUser } from "@/lib/session";

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

interface RouteParams {
  params: Promise<{ id: string }>;
}

/**
 * GET /api/snapshots/[id] — fetch a single snapshot's full data.
 *
 * Returns D1 metadata + full JSON from R2.
 */
export async function GET(_request: Request, { params }: RouteParams) {
  const user = await getAuthUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;

  try {
    // 1. Fetch metadata from D1
    const row = await queryFirst<SnapshotRow>(
      `SELECT id, user_id, webhook_id, hostname, platform, arch, username,
              collector_count, file_count, list_count, size_bytes, r2_key,
              snapshot_at, uploaded_at
       FROM snapshots
       WHERE id = ?1 AND user_id = ?2`,
      [id, user.id],
    );

    if (!row) {
      return NextResponse.json({ error: "Snapshot not found" }, { status: 404 });
    }

    // 2. Fetch full snapshot JSON from R2
    const r2Key = snapshotKey(user.id, id);
    const data = await getSnapshot(r2Key);

    if (!data) {
      return NextResponse.json({ error: "Snapshot data not found in storage" }, { status: 404 });
    }

    return NextResponse.json({
      snapshot: {
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
      },
      data,
    });
  } catch (err) {
    console.error(`GET /api/snapshots/${id} failed:`, err);
    return NextResponse.json({ error: "Failed to fetch snapshot from database" }, { status: 500 });
  }
}
