import type { RemoteReceipt } from "@otter/core";
import type { DbDriver } from "./db/driver";
import type { R2BucketLike } from "./r2";
import { extractSnapshotMetadata, type SnapshotPayload, sha256 } from "./snapshot-payload";
import { getSnapshotMeta, insertSnapshotStatement, snapshotR2Key } from "./snapshot-repo";
import { ensureUser } from "./user-repo";

export class SnapshotWriteError extends Error {
  constructor(
    message: string,
    readonly status: 409 | 500,
  ) {
    super(message);
  }
}

async function storeObject(
  bucket: R2BucketLike,
  key: string,
  json: string,
  hash: string,
): Promise<string> {
  let receivedAt = new Date().toISOString();
  try {
    let existing = await bucket.get(key);
    if (!existing) {
      const put = await bucket.put(key, json, {
        onlyIf: { etagDoesNotMatch: "*" },
        httpMetadata: { contentType: "application/json" },
        customMetadata: { sha256: hash, receivedAt },
      });
      if (put === null) existing = await bucket.get(key);
      if (put === null && !existing) throw new Error("Concurrent object is unavailable; retry");
    }
    if (existing) {
      if ((await sha256(JSON.stringify(JSON.parse(await existing.text())))) !== hash)
        throw new SnapshotWriteError("Snapshot ID already exists with different content", 409);
      receivedAt = existing.customMetadata?.["receivedAt"] ?? receivedAt;
    }
  } catch (error) {
    if (error instanceof SnapshotWriteError) throw error;
    throw new SnapshotWriteError("Failed to store snapshot", 500);
  }
  return receivedAt;
}

/** Conditional R2 create + idempotent D1 indexing. An index failure leaves a retryable immutable object. */
export async function storeSnapshot(
  driver: DbDriver,
  bucket: R2BucketLike,
  email: string,
  snapshot: SnapshotPayload,
  webhookId: string | null = null,
): Promise<{ receipt: RemoteReceipt; created: boolean }> {
  const json = JSON.stringify(snapshot),
    hash = await sha256(json),
    key = snapshotR2Key(email, snapshot.id);
  const receivedAt = await storeObject(bucket, key, json, hash);
  try {
    await ensureUser(driver, email);
    const w = snapshot.workspace;
    const insert = insertSnapshotStatement({
      id: snapshot.id,
      userId: email,
      webhookId,
      meta: extractSnapshotMetadata(snapshot),
      sizeBytes: new TextEncoder().encode(json).length,
      r2Key: key,
      snapshotAt: Date.parse(snapshot.createdAt),
      uploadedAt: Date.parse(receivedAt),
      schemaVersion: snapshot.version,
      sha256: hash,
      ...(w
        ? {
            deviceId: w.deviceId,
            complete: w.coverage.complete,
            summary: {
              sourceCount: w.roots.filter((r) => r.role === "source").length,
              agentCount: w.agents.length,
              resourceCount: w.resources.length,
              issues: w.coverage.issues.length,
            },
          }
        : {}),
    });
    const inserted = await driver.execute(insert.sql, insert.params);
    const row = await getSnapshotMeta(driver, email, snapshot.id);
    if (!row || (row.sha256 && row.sha256 !== hash))
      throw new Error("Index does not match stored content");
    const chunks = searchChunks(snapshot);
    const searchStatements = [];
    for (let offset = 0; offset < chunks.length; offset += 32) {
      const parts = chunks.slice(offset, offset + 32);
      searchStatements.push({
        sql: `INSERT INTO snapshot_search (user_id, snapshot_id, part, terms) VALUES ${parts.map((_, i) => `(?1, ?2, ?${3 + i * 2}, ?${4 + i * 2})`).join(",")} ON CONFLICT(user_id, snapshot_id, part) DO NOTHING`,
        params: [email, snapshot.id, ...parts.flatMap((terms, i) => [offset + i, terms])],
      });
    }
    await driver.batch(searchStatements);
    if (webhookId)
      await driver.execute("UPDATE webhooks SET last_used_at = ?1 WHERE id = ?2", [
        Date.now(),
        webhookId,
      ]);
    return {
      created: inserted.changes > 0,
      receipt: {
        snapshotId: snapshot.id,
        sha256: hash,
        account: email,
        receivedAt: new Date(row.uploaded_at).toISOString(),
      },
    };
  } catch {
    throw new SnapshotWriteError("Failed to index snapshot", 500);
  }
}

function searchValues(values: unknown[], field: string): string[] {
  return values.flatMap((value) => {
    const term = value && typeof value === "object" ? Reflect.get(value, field) : undefined;
    return typeof term === "string" ? [term] : [];
  });
}

/** Search filenames/resource identities; never duplicate saved configuration text into D1. */
function searchChunks(snapshot: SnapshotPayload): string[] {
  const w = snapshot.workspace;
  const terms = new Set<string>([
    ...(w?.roots.flatMap((r) => [r.path, r.label]) ?? []),
    ...(w?.agents.flatMap((a) => [a.kind, a.profile, a.configPath]) ?? []),
    ...(w?.resources.flatMap((r) => [r.name, r.path]) ?? []),
  ]);
  for (const collector of snapshot.collectors) {
    for (const term of [
      ...searchValues(collector.files, "path"),
      ...searchValues(collector.lists, "name"),
    ])
      terms.add(term);
  }
  const chunks: string[] = [];
  let current = "";
  for (const raw of terms) {
    const term = raw.slice(0, 8192);
    if (current.length + term.length > 100_000) {
      chunks.push(current);
      current = "";
    }
    current += `${term}\n`;
  }
  if (current) chunks.push(current);
  return chunks;
}
