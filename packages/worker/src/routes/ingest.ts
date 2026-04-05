import { Hono } from "hono";
import { putSnapshot, snapshotKey } from "../services/snapshot.js";
import { validateWebhookToken } from "../services/webhook.js";
import type { Env, Variables } from "../types.js";

// biome-ignore lint/style/useNamingConvention: Hono generic parameter names
export const ingestRoutes = new Hono<{ Bindings: Env; Variables: Variables }>();

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
  // biome-ignore lint/style/useNamingConvention: D1 column name
  user_id: string;
  token: string;
  // biome-ignore lint/style/useNamingConvention: D1 column name
  is_active: number;
}

/**
 * Validate that the parsed JSON has the shape of a Snapshot.
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
    hostname: machine.computerName ?? machine.hostname,
    platform: machine.platform,
    arch: machine.arch,
    username: machine.username,
    collectorCount: snapshot.collectors.length,
    fileCount,
    listCount,
  };
}

/** Decompress gzip body if Content-Encoding is gzip */
async function decompressBody(request: Request): Promise<{ json: string; error?: string }> {
  try {
    const rawBody = await request.arrayBuffer();
    const contentEncoding = request.headers.get("content-encoding");

    if (contentEncoding === "gzip") {
      // Use DecompressionStream for gzip decompression
      const stream = new ReadableStream({
        start(controller) {
          controller.enqueue(new Uint8Array(rawBody));
          controller.close();
        },
      });
      const decompressedStream = stream.pipeThrough(new DecompressionStream("gzip"));
      const decompressedBuffer = await new Response(decompressedStream).arrayBuffer();
      return { json: new TextDecoder().decode(decompressedBuffer) };
    }

    return { json: new TextDecoder().decode(rawBody) };
  } catch {
    return { json: "", error: "Failed to decompress request body" };
  }
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
  const { json: jsonString, error: decompressError } = await decompressBody(c.req.raw);
  if (decompressError) {
    return c.json({ error: decompressError }, 400);
  }

  // 3. Parse and validate JSON
  let snapshot: Snapshot;
  try {
    const parsed: unknown = JSON.parse(jsonString);
    if (!isValidSnapshot(parsed)) {
      return c.json({ error: "Invalid snapshot format" }, 400);
    }
    snapshot = parsed;
  } catch {
    return c.json({ error: "Invalid JSON body" }, 400);
  }

  // 4. Store raw JSON in R2 (R2 first, D1 second)
  const r2Key = snapshotKey(webhook.user_id, snapshot.id);
  const sizeBytes = new TextEncoder().encode(jsonString).length;

  try {
    await putSnapshot(c.env.SNAPSHOTS, r2Key, jsonString);
  } catch (error) {
    console.error("[ingest] Failed to store snapshot in R2:", error);
    return c.json({ error: "Failed to store snapshot" }, 500);
  }

  // 5. Write snapshot metadata to D1 + update webhook last_used_at
  const meta = extractMetadata(snapshot);
  const now = Date.now();
  const snapshotAt = new Date(snapshot.createdAt).getTime();

  try {
    // D1 native batch
    await c.env.DB.batch([
      c.env.DB.prepare(
        `INSERT INTO snapshots (
          id, user_id, webhook_id, hostname, platform, arch, username,
          collector_count, file_count, list_count, size_bytes, r2_key,
          snapshot_at, uploaded_at
        ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14)`,
      ).bind(
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
      ),
      c.env.DB.prepare(`UPDATE webhooks SET last_used_at = ?1 WHERE id = ?2`).bind(now, webhook.id),
    ]);
  } catch (error) {
    console.error("[ingest] Failed to write snapshot metadata to D1:", error);
    return c.json({ error: "Failed to index snapshot" }, 500);
  }

  return c.json(
    {
      success: true,
      snapshotId: snapshot.id,
    },
    201,
  );
});
