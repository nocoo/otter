import { mkdir, readdir, readFile, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { Snapshot } from "@otter/core";

const MILLIS_SUFFIX = /\.\d{3}Z$/;
const COLON = /:/g;

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
}

/**
 * Convert an ISO 8601 timestamp to a filesystem-safe string.
 * Replaces colons with dashes to avoid issues on Windows.
 * Example: "2026-03-06T12:30:00.000Z" → "2026-03-06T12-30-00"
 */
function toFileTimestamp(iso: string): string {
  return iso.replace(COLON, "-").replace(MILLIS_SUFFIX, "");
}

/**
 * Build the snapshot filename from its metadata.
 * Format: `{timestamp}_{shortId}.json`
 */
function buildFilename(snapshot: Snapshot): string {
  const ts = toFileTimestamp(snapshot.createdAt);
  const shortId = snapshot.id.slice(0, 8);
  return `${ts}_${shortId}.json`;
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
    await mkdir(this.storageDir, { recursive: true });
    const filename = buildFilename(snapshot);
    const filePath = join(this.storageDir, filename);
    await writeFile(filePath, `${JSON.stringify(snapshot, null, 2)}\n`);
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

    const results = await Promise.all(
      jsonFiles.map((filename) => parseMetaFromFile(join(this.storageDir, filename), filename)),
    );
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
    const match = metas.find((m) => m.shortId === shortId || m.id === shortId);
    if (!match) return null;

    try {
      const raw = await readFile(join(this.storageDir, match.filename), "utf-8");
      return JSON.parse(raw) as Snapshot;
    } catch {
      return null;
    }
  }
}
