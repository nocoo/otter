import { randomUUID } from "node:crypto";
import { link, mkdir, readdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { Snapshot } from "@otter/core";
import { digest } from "../workspace/files.js";

const SNAPSHOT_ID = /^[A-Za-z\d_-]{1,128}$/;

/** Metadata for a locally-stored snapshot (without loading full content) */
export interface SnapshotMeta {
  /** Full UUID */
  id: string;
  /** First 8 characters of UUID — used as short reference */
  shortId: string;
  /** ISO 8601 creation timestamp */
  createdAt: string;
  /** Filename on disk */
  filename: string;
  /** File size in bytes */
  sizeBytes: number;
  /** Number of collectors in the snapshot */
  collectorCount: number;
  /** Total collected files across all collectors */
  fileCount: number;
  /** Total list items across all collectors */
  listCount: number;
  schemaVersion?: number;
  deviceId?: string;
  complete?: boolean;
  fingerprint?: string;
  hostname?: string;
}

/**
 * One canonical destination per ID makes conflicting concurrent writes impossible.
 * Legacy timestamped filenames remain readable.
 */
function buildFilename(snapshot: Snapshot): string {
  if (!SNAPSHOT_ID.test(snapshot.id) || !Number.isFinite(Date.parse(snapshot.createdAt)))
    throw new Error("Invalid snapshot identity or timestamp");
  return `${snapshot.id}.json`;
}

/**
 * Parse snapshot metadata from a stored JSON file without loading
 * the full collector content into memory. Reads only what's needed.
 */
async function parseMetaFromFile(filePath: string, filename: string): Promise<SnapshotMeta | null> {
  try {
    const info = await stat(filePath);
    const raw = await readFile(filePath, "utf-8");
    const snapshot: Snapshot = JSON.parse(raw);

    return {
      id: snapshot.id,
      shortId: snapshot.id.slice(0, 8),
      createdAt: snapshot.createdAt,
      filename,
      sizeBytes: info.size,
      collectorCount: snapshot.collectors.length,
      fileCount: snapshot.collectors.reduce((sum, c) => sum + c.files.length, 0),
      listCount: snapshot.collectors.reduce((sum, c) => sum + c.lists.length, 0),
      schemaVersion: snapshot.version,
      hostname: snapshot.machine.computerName ?? snapshot.machine.hostname,
      ...(snapshot.workspace
        ? {
            deviceId: snapshot.workspace.deviceId,
            complete: snapshot.workspace.coverage.complete,
            fingerprint: snapshot.workspace.contentFingerprint,
          }
        : {}),
    };
  } catch {
    // Corrupt or unreadable file — skip it
    return null;
  }
}

/**
 * Local snapshot storage manager.
 * Persists snapshots as JSON files in a dedicated directory.
 */
export class SnapshotStore {
  constructor(private readonly storageDir: string) {}

  /**
   * Save a snapshot to local storage.
   * Creates the storage directory if it doesn't exist.
   * @returns The filename of the saved snapshot.
   */
  async save(snapshot: Snapshot): Promise<string> {
    await mkdir(this.storageDir, { recursive: true, mode: 0o700 });
    const filename = buildFilename(snapshot);
    const existing = await this.load(snapshot.id);
    if (existing && digest(JSON.stringify(existing)) !== digest(JSON.stringify(snapshot)))
      throw new Error("Snapshot ID already exists with different content");
    if (existing)
      return (await this.list()).find((meta) => meta.id === snapshot.id)?.filename ?? filename;
    const filePath = join(this.storageDir, filename);
    const temporary = join(this.storageDir, `.${randomUUID()}.tmp`);
    try {
      await writeFile(temporary, `${JSON.stringify(snapshot, null, 2)}\n`, {
        mode: 0o600,
        flag: "wx",
      });
      try {
        await link(temporary, filePath);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
        const winner = JSON.parse(await readFile(filePath, "utf8")) as Snapshot;
        if (digest(JSON.stringify(winner)) !== digest(JSON.stringify(snapshot)))
          throw new Error("Snapshot ID already exists with different content");
      }
    } finally {
      await rm(temporary, { force: true });
    }
    return filename;
  }

  /**
   * List all locally-stored snapshots, sorted by creation date (newest first).
   */
  async list(): Promise<SnapshotMeta[]> {
    let entries: string[];
    try {
      entries = await readdir(this.storageDir);
    } catch {
      // Directory doesn't exist yet — no snapshots stored
      return [];
    }

    const jsonFiles = entries.filter((f) => f.endsWith(".json"));

    const results: (SnapshotMeta | null)[] = [];
    for (const filename of jsonFiles) {
      // biome-ignore lint/performance/noAwaitInLoops: bound memory to one potentially large recovery snapshot
      results.push(await parseMetaFromFile(join(this.storageDir, filename), filename));
    }
    const metas = results.filter((m): m is SnapshotMeta => m !== null);

    // Sort newest first
    metas.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

    return metas;
  }

  /**
   * Load a snapshot by its short ID prefix (first 8 chars of UUID).
   * Returns null if no matching snapshot is found.
   */
  async load(shortId: string): Promise<Snapshot | null> {
    const metas = await this.list();
    const matches = metas.filter((m) => m.shortId === shortId || m.id === shortId);
    if (matches.length > 1) throw new Error("Ambiguous snapshot ID; use the full ID");
    const match = matches[0];
    if (!match) return null;

    try {
      const raw = await readFile(join(this.storageDir, match.filename), "utf-8");
      return JSON.parse(raw) as Snapshot;
    } catch {
      return null;
    }
  }
}
