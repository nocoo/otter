import pc from "picocolors";
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

export { formatSize, formatDate };
