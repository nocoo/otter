import pc from "picocolors";
import type { Snapshot } from "@otter/core";
import type { SnapshotMeta } from "../storage/local.js";

/**
 * Format a file size in bytes to a human-readable string.
 */
function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const kb = bytes / 1024;
  if (kb < 1024) return `${kb.toFixed(kb < 100 ? 1 : 0)} KB`;
  const mb = kb / 1024;
  return `${mb.toFixed(1)} MB`;
}

/**
 * Format an ISO 8601 date string to a short "YYYY-MM-DD HH:MM" format.
 */
function formatDate(iso: string): string {
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/**
 * Format the snapshot list output for the terminal.
 * Pure logic function, returns lines to print.
 */
export function formatSnapshotList(metas: SnapshotMeta[]): string {
  if (metas.length === 0) {
    return "No local snapshots found.";
  }

  const header = `Local snapshots (${metas.length}):\n`;
  const rows = metas.map((m) => {
    const id = pc.bold(m.shortId);
    const date = pc.dim(formatDate(m.createdAt));
    const collectors = `${m.collectorCount} collectors`;
    const files = `${m.fileCount} files`;
    const lists = `${m.listCount} items`;
    const size = pc.dim(formatSize(m.sizeBytes));
    return `  ${id}  ${date}  ${collectors}  ${files}  ${lists}  ${size}`;
  });

  return header + rows.join("\n");
}

// ---------------------------------------------------------------------------
// snapshot show
// ---------------------------------------------------------------------------

/**
 * Format a detailed view of a single snapshot.
 */
export function formatSnapshotDetail(snapshot: Snapshot): string {
  const lines: string[] = [];
  const m = snapshot.machine;

  lines.push(`Snapshot ${pc.bold(snapshot.id.slice(0, 8))}`);
  lines.push(`  Created: ${formatDate(snapshot.createdAt)}`);
  lines.push(
    `  Machine: ${m.hostname} (${m.platform}/${m.arch}, ${m.osVersion})`
  );
  lines.push(`  User:    ${m.username}`);
  lines.push("");

  for (const c of snapshot.collectors) {
    const status = c.errors.length > 0 ? pc.yellow("⚠") : pc.green("✓");
    lines.push(
      `${status} ${pc.bold(c.label)} [${c.id}]  ${c.files.length} files, ${c.lists.length} items`
    );

    for (const f of c.files) {
      lines.push(`    ${pc.dim(f.path)} (${formatSize(f.sizeBytes)})`);
    }

    if (c.lists.length > 0) {
      const preview = c.lists
        .slice(0, 10)
        .map((l) => l.name)
        .join(", ");
      const suffix = c.lists.length > 10 ? `, ... +${c.lists.length - 10} more` : "";
      lines.push(`    ${pc.dim(`items: ${preview}${suffix}`)}`);
    }

    if (c.errors.length > 0) {
      for (const e of c.errors) {
        lines.push(`    ${pc.yellow(`error: ${e}`)}`);
      }
    }
  }

  return lines.join("\n");
}

// ---------------------------------------------------------------------------
// snapshot diff
// ---------------------------------------------------------------------------

/** A single diff entry describing an added, removed, or changed item */
export interface DiffEntry {
  type: "added" | "removed" | "changed";
  label: string;
}

/** Diff result for a single collector */
export interface CollectorDiff {
  collectorId: string;
  collectorLabel: string;
  files: DiffEntry[];
  lists: DiffEntry[];
}

/** Full diff result between two snapshots */
export interface SnapshotDiffResult {
  oldId: string;
  newId: string;
  addedCollectors: string[];
  removedCollectors: string[];
  collectors: CollectorDiff[];
}

/**
 * Compute the diff between two snapshots at file+list level.
 * Files are compared by path; lists are compared by name.
 * Content-level diffing is out of scope — only presence/absence is tracked,
 * plus a "changed" marker when a file exists in both but size differs.
 */
export function diffSnapshots(
  oldSnap: Snapshot,
  newSnap: Snapshot
): SnapshotDiffResult {
  const oldCollectorMap = new Map(oldSnap.collectors.map((c) => [c.id, c]));
  const newCollectorMap = new Map(newSnap.collectors.map((c) => [c.id, c]));

  const allIds = new Set([...oldCollectorMap.keys(), ...newCollectorMap.keys()]);

  const addedCollectors: string[] = [];
  const removedCollectors: string[] = [];
  const collectors: CollectorDiff[] = [];

  for (const id of allIds) {
    const oldC = oldCollectorMap.get(id);
    const newC = newCollectorMap.get(id);

    if (!oldC && newC) {
      addedCollectors.push(newC.label);
      continue;
    }
    if (oldC && !newC) {
      removedCollectors.push(oldC.label);
      continue;
    }

    // Both exist — diff files and lists
    const fileDiffs = diffFiles(oldC!.files, newC!.files);
    const listDiffs = diffLists(oldC!.lists, newC!.lists);

    if (fileDiffs.length > 0 || listDiffs.length > 0) {
      collectors.push({
        collectorId: id,
        collectorLabel: newC!.label,
        files: fileDiffs,
        lists: listDiffs,
      });
    }
  }

  return {
    oldId: oldSnap.id.slice(0, 8),
    newId: newSnap.id.slice(0, 8),
    addedCollectors,
    removedCollectors,
    collectors,
  };
}

function diffFiles(
  oldFiles: Snapshot["collectors"][0]["files"],
  newFiles: Snapshot["collectors"][0]["files"]
): DiffEntry[] {
  const oldMap = new Map(oldFiles.map((f) => [f.path, f]));
  const newMap = new Map(newFiles.map((f) => [f.path, f]));
  const entries: DiffEntry[] = [];

  for (const [path, newFile] of newMap) {
    const oldFile = oldMap.get(path);
    if (!oldFile) {
      entries.push({ type: "added", label: path });
    } else if (oldFile.sizeBytes !== newFile.sizeBytes) {
      entries.push({ type: "changed", label: path });
    }
  }

  for (const path of oldMap.keys()) {
    if (!newMap.has(path)) {
      entries.push({ type: "removed", label: path });
    }
  }

  return entries;
}

function diffLists(
  oldLists: Snapshot["collectors"][0]["lists"],
  newLists: Snapshot["collectors"][0]["lists"]
): DiffEntry[] {
  const oldNames = new Set(oldLists.map((l) => l.name));
  const newNames = new Set(newLists.map((l) => l.name));
  const entries: DiffEntry[] = [];

  for (const name of newNames) {
    if (!oldNames.has(name)) {
      entries.push({ type: "added", label: name });
    }
  }

  for (const name of oldNames) {
    if (!newNames.has(name)) {
      entries.push({ type: "removed", label: name });
    }
  }

  return entries;
}

/**
 * Format a diff result for terminal output.
 */
export function formatSnapshotDiff(diff: SnapshotDiffResult): string {
  const lines: string[] = [];

  lines.push(
    `Diff: ${pc.bold(diff.oldId)} → ${pc.bold(diff.newId)}`
  );
  lines.push("");

  const hasChanges =
    diff.addedCollectors.length > 0 ||
    diff.removedCollectors.length > 0 ||
    diff.collectors.length > 0;

  if (!hasChanges) {
    lines.push("No differences found.");
    return lines.join("\n");
  }

  if (diff.addedCollectors.length > 0) {
    lines.push(`${pc.green("+ Collectors added:")} ${diff.addedCollectors.join(", ")}`);
  }
  if (diff.removedCollectors.length > 0) {
    lines.push(`${pc.red("- Collectors removed:")} ${diff.removedCollectors.join(", ")}`);
  }

  for (const c of diff.collectors) {
    if (c.files.length === 0 && c.lists.length === 0) continue;

    lines.push("");
    lines.push(`${pc.bold(c.collectorLabel)} [${c.collectorId}]`);

    for (const f of c.files) {
      const prefix =
        f.type === "added"
          ? pc.green("+")
          : f.type === "removed"
            ? pc.red("-")
            : pc.yellow("~");
      lines.push(`  ${prefix} ${f.label}`);
    }

    for (const l of c.lists) {
      const prefix = l.type === "added" ? pc.green("+") : pc.red("-");
      lines.push(`  ${prefix} ${l.label}`);
    }
  }

  return lines.join("\n");
}

export { formatSize, formatDate };
