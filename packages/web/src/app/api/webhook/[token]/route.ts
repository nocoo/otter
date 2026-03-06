import { NextResponse } from "next/server";
import { gunzipSync } from "node:zlib";
import { queryFirst, batch } from "@/lib/cf/d1";
import { putSnapshot, snapshotKey } from "@/lib/cf/r2";

/** Minimal Snapshot shape for validation and metadata extraction */
interface Snapshot {
  version: 1;
  id: string;
  createdAt: string;
  machine: {
    hostname: string;
    computerName?: string;
    platform: string;
    arch: string;
    username: string;
  };
  collectors: Array<{
    files: Array<unknown>;
    lists: Array<unknown>;
  }>;
}

interface WebhookRow {
  id: string;
  user_id: string;
  token: string;
  is_active: number;
}

interface RouteParams {
  params: Promise<{ token: string }>;
}

/**
 * Validate that the parsed JSON has the shape of a Snapshot.
 * We do structural validation (not Zod) to keep it lightweight.
 */
function isValidSnapshot(data: unknown): data is Snapshot {
  if (typeof data !== "object" || data === null) return false;
  const obj = data as Record<string, unknown>;
  return (
    obj.version === 1 &&
    typeof obj.id === "string" &&
    typeof obj.createdAt === "string" &&
    typeof obj.machine === "object" &&
    obj.machine !== null &&
    Array.isArray(obj.collectors)
  );
}

/** Extract metadata from a validated Snapshot for D1 indexing */
function extractMetadata(snapshot: Snapshot) {
  const machine = snapshot.machine;
  let fileCount = 0;
  let listCount = 0;
  for (const collector of snapshot.collectors) {
    fileCount += collector.files.length;
    listCount += collector.lists.length;
  }
  return {
    hostname: machine.computerName || machine.hostname,
    platform: machine.platform,
    arch: machine.arch,
    username: machine.username,
    collectorCount: snapshot.collectors.length,
    fileCount,
    listCount,
  };
}

/** POST /api/webhook/[token] — receive CLI snapshot uploads */
export async function POST(request: Request, { params }: RouteParams) {
  const { token } = await params;

  // 1. Validate webhook token
  const webhook = await queryFirst<WebhookRow>(
    `SELECT id, user_id, token, is_active FROM webhooks WHERE token = ?1`,
    [token],
  );

  if (!webhook) {
    return NextResponse.json(
      { error: "Invalid webhook token" },
      { status: 401 },
    );
  }

  if (webhook.is_active !== 1) {
    return NextResponse.json(
      { error: "Webhook is disabled" },
      { status: 403 },
    );
  }

  // 2. Read and decompress the body
  let jsonString: string;
  try {
    const rawBody = await request.arrayBuffer();
    const contentEncoding = request.headers.get("content-encoding");

    if (contentEncoding === "gzip") {
      const decompressed = gunzipSync(Buffer.from(rawBody));
      jsonString = decompressed.toString("utf-8");
    } else {
      jsonString = new TextDecoder().decode(rawBody);
    }
  } catch {
    return NextResponse.json(
      { error: "Failed to decompress request body" },
      { status: 400 },
    );
  }

  // 3. Parse and validate JSON
  let snapshot: Snapshot;
  try {
    const parsed: unknown = JSON.parse(jsonString);
    if (!isValidSnapshot(parsed)) {
      return NextResponse.json(
        { error: "Invalid snapshot format" },
        { status: 400 },
      );
    }
    snapshot = parsed;
  } catch {
    return NextResponse.json(
      { error: "Invalid JSON body" },
      { status: 400 },
    );
  }

  // 4. Store raw JSON in R2
  const r2Key = snapshotKey(webhook.user_id, snapshot.id);
  const sizeBytes = Buffer.byteLength(jsonString, "utf-8");

  try {
    await putSnapshot(r2Key, snapshot);
  } catch (error) {
    console.error("[webhook] Failed to store snapshot in R2:", error);
    return NextResponse.json(
      { error: "Failed to store snapshot" },
      { status: 500 },
    );
  }

  // 5. Write snapshot metadata to D1 + update webhook last_used_at
  const meta = extractMetadata(snapshot);
  const now = Date.now();
  const snapshotAt = new Date(snapshot.createdAt).getTime();

  try {
    await batch([
      {
        sql: `INSERT INTO snapshots (
                id, user_id, webhook_id, hostname, platform, arch, username,
                collector_count, file_count, list_count, size_bytes, r2_key,
                snapshot_at, uploaded_at
              ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14)`,
        params: [
          snapshot.id,
          webhook.user_id,
          webhook.id,
          meta.hostname,
          meta.platform,
          meta.arch,
          meta.username,
          meta.collectorCount,
          meta.fileCount,
          meta.listCount,
          sizeBytes,
          r2Key,
          snapshotAt,
          now,
        ],
      },
      {
        sql: `UPDATE webhooks SET last_used_at = ?1 WHERE id = ?2`,
        params: [now, webhook.id],
      },
    ]);
  } catch (error) {
    console.error("[webhook] Failed to write snapshot metadata to D1:", error);
    return NextResponse.json(
      { error: "Failed to index snapshot" },
      { status: 500 },
    );
  }

  return NextResponse.json(
    {
      success: true,
      snapshotId: snapshot.id,
    },
    { status: 201 },
  );
}
