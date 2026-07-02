// Snapshot payload validation + metadata extraction, shared between
// /api/snapshots (Bearer) and legacy /ingest/:token (webhook token) routes.

export interface SnapshotPayload {
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

export interface SnapshotIndexMetadata {
  hostname: string;
  platform: string;
  arch: string;
  username: string;
  collectorCount: number;
  fileCount: number;
  listCount: number;
}

export function isValidSnapshotPayload(data: unknown): data is SnapshotPayload {
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

export function extractSnapshotMetadata(snapshot: SnapshotPayload): SnapshotIndexMetadata {
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
