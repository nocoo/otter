import { pc } from "@nocoo/cli-base";
import type { Snapshot } from "@otter/core";
import type { SnapshotMeta } from "../storage/local.js";
import { type Column, formatDate, formatSize, S, type TreeChild, table, tree } from "../ui.js";

const HOME_DIR_PREFIX = /^\/Users\/[^/]+/;

// ── snapshot list ───────────────────────────────────────────────────

/**
 * Format the snapshot list output for the terminal.
 * Pure logic function, returns lines to print.
 */
export function formatSnapshotList(metas: SnapshotMeta[]): string {
  if (metas.length === 0) {
    return "\n  No local snapshots found.\n";
  }

  const columns: Column[] = [
    { label: "ID" },
    { label: "Date" },
    { label: "Collectors", align: "right" },
    { label: "Files", align: "right" },
    { label: "Items", align: "right" },
    { label: "Size", align: "right" },
  ];

  const rows = metas.map((m) => [
    pc.bold(m.shortId),
    pc.dim(formatDate(m.createdAt)),
    String(m.collectorCount),
    String(m.fileCount),
    String(m.listCount),
    formatSize(m.sizeBytes),
  ]);

  return `\n  Local snapshots (${metas.length}):\n\n${table(columns, rows)}\n`;
}

// ── snapshot show ───────────────────────────────────────────────────

/**
 * Format a detailed view of a single snapshot.
 */
// biome-ignore lint/complexity/noExcessiveCognitiveComplexity: multi-section tree builder
export function formatSnapshotDetail(snapshot: Snapshot): string {
  const lines: string[] = [];
  const m = snapshot.machine;
  const machineName = m.computerName || m.hostname;

  lines.push("");
  lines.push(`  Snapshot ${pc.bold(snapshot.id.slice(0, 8))}`);
  lines.push(`  Created: ${pc.dim(formatDate(snapshot.createdAt))}`);
  lines.push(`  Machine: ${pc.dim(`${machineName} (${m.platform}/${m.arch}, ${m.osVersion})`)}`);
  lines.push(`  User:    ${pc.dim(m.username)}`);
  lines.push("");

  for (const c of snapshot.collectors) {
    const status = c.errors.length > 0 ? S.warning : S.success;
    const meta = pc.dim(`${c.files.length} files, ${c.lists.length} items`);
    lines.push(`  ${status}  ${pc.bold(c.label)}  ${meta}`);

    // Build tree children
    const children: TreeChild[] = [];

    // Files
    for (const f of c.files) {
      // Shorten home dir paths for readability
      const shortPath = f.path.replace(HOME_DIR_PREFIX, "~");
      children.push({ text: shortPath, detail: formatSize(f.sizeBytes) });
    }

    // List items preview
    if (c.lists.length > 0) {
      const preview = c.lists
        .slice(0, 10)
        .map((l) => l.name)
        .join(", ");
      const suffix = c.lists.length > 10 ? `, ... +${c.lists.length - 10} more` : "";
      children.push({ text: `items: ${preview}${suffix}`, dim: true });
    }

    // Errors (real failures)
    for (const e of c.errors) {
      children.push({ text: e, color: "yellow" });
    }

    // Skipped (tools not installed — informational, not errors)
    for (const s of c.skipped ?? []) {
      children.push({ text: s, dim: true });
    }

    if (children.length > 0) {
      lines.push(tree(children));
    }

    lines.push("");
  }

  return lines.join("\n");
}

// ── snapshot diff ───────────────────────────────────────────────────

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
export function diffSnapshots(oldSnap: Snapshot, newSnap: Snapshot): SnapshotDiffResult {
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
    // biome-ignore lint/style/noNonNullAssertion: guaranteed non-null — early returns above handle the null cases
    const fileDiffs = diffFiles(oldC!.files, newC!.files);
    // biome-ignore lint/style/noNonNullAssertion: guaranteed non-null — early returns above handle the null cases
    const listDiffs = diffLists(oldC!.lists, newC!.lists);

    if (fileDiffs.length > 0 || listDiffs.length > 0) {
      collectors.push({
        collectorId: id,
        // biome-ignore lint/style/noNonNullAssertion: guaranteed non-null — early returns above handle the null cases
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
  newFiles: Snapshot["collectors"][0]["files"],
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
  newLists: Snapshot["collectors"][0]["lists"],
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
 * Format a diff result for terminal output using tree views.
 */
// biome-ignore lint/complexity/noExcessiveCognitiveComplexity: multi-section diff formatter
export function formatSnapshotDiff(diff: SnapshotDiffResult): string {
  const lines: string[] = [];

  lines.push("");
  lines.push(`  Diff: ${pc.bold(diff.oldId)} \u2192 ${pc.bold(diff.newId)}`);
  lines.push("");

  const hasChanges =
    diff.addedCollectors.length > 0 ||
    diff.removedCollectors.length > 0 ||
    diff.collectors.length > 0;

  if (!hasChanges) {
    lines.push("  No differences found.");
    lines.push("");
    return lines.join("\n");
  }

  if (diff.addedCollectors.length > 0) {
    lines.push(`  ${pc.green("+")} Collectors added: ${diff.addedCollectors.join(", ")}`);
  }
  if (diff.removedCollectors.length > 0) {
    lines.push(`  ${pc.red("-")} Collectors removed: ${diff.removedCollectors.join(", ")}`);
  }

  for (const c of diff.collectors) {
    if (c.files.length === 0 && c.lists.length === 0) continue;

    lines.push("");
    lines.push(`  ${pc.bold(c.collectorLabel)}`);

    const children: TreeChild[] = [];

    for (const f of c.files) {
      const prefix = f.type === "added" ? "+" : f.type === "removed" ? "-" : "~";
      const color: TreeChild["color"] =
        f.type === "added" ? "green" : f.type === "removed" ? "red" : "yellow";
      children.push({ text: `${prefix} ${f.label}`, color });
    }

    for (const l of c.lists) {
      const prefix = l.type === "added" ? "+" : "-";
      const color: TreeChild["color"] = l.type === "added" ? "green" : "red";
      children.push({ text: `${prefix} ${l.label}`, color });
    }

    if (children.length > 0) {
      lines.push(tree(children));
    }
  }

  lines.push("");
  return lines.join("\n");
}

export { formatDate, formatSize };
