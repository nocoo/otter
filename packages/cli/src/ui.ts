/**
 * ui.ts — Otter CLI output primitives
 *
 * Centralizes all terminal output formatting. Every visual element
 * (banner, progress items, tables, trees, boxes) is defined here
 * so cli.ts and snapshot.ts stay focused on logic.
 */

import { consola } from "consola";
import pc from "picocolors";

// ── Symbols ─────────────────────────────────────────────────────────

export const S = {
  success: pc.green("✓"),
  warning: pc.yellow("▲"),
  error: pc.red("✗"),
  step: pc.cyan("◆"),
  info: pc.cyan("●"),
  bar: pc.dim("│"),
  treeItem: pc.dim("├──"),
  treeLast: pc.dim("└──"),
} as const;

// ── Duration / Size formatting ──────────────────────────────────────

export function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
  const min = Math.floor(ms / 60_000);
  const sec = Math.floor((ms % 60_000) / 1000);
  return `${min}m ${sec}s`;
}

export function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const kb = bytes / 1024;
  if (kb < 1024) return `${kb.toFixed(1)} KB`;
  const mb = kb / 1024;
  if (mb < 1024) return `${mb.toFixed(2)} MB`;
  const gb = mb / 1024;
  return `${gb.toFixed(2)} GB`;
}

export function formatDate(iso: string): string {
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

// ── Banner ──────────────────────────────────────────────────────────

export function banner(version: string): void {
  const label = `${pc.bgCyan(pc.black(` otter `))}  ${pc.dim(`v${version}`)}`;
  console.log(`\n${label}\n`);
}

// ── Step header (for multi-phase commands like backup) ──────────────

export function step(message: string, current?: number, total?: number): void {
  const counter = current != null && total != null ? ` ${pc.dim(`(${current}/${total})`)}` : "";
  console.log(`${S.step}  ${message}${counter}`);
}

// ── Collector result item ───────────────────────────────────────────

export interface ItemOptions {
  label: string;
  fileCount: number;
  listCount: number;
  errorCount: number;
  skippedCount: number;
  durationMs: number;
  /** Max label width for alignment. Defaults to 30. */
  labelWidth?: number;
}

export function item(opts: ItemOptions): void {
  const { label, fileCount, listCount, errorCount, skippedCount, durationMs } = opts;
  const w = opts.labelWidth ?? 30;
  const status = errorCount > 0 ? S.warning : S.success;
  const files = `${fileCount} files`.padStart(8);
  const items = `${listCount} items`.padStart(9);
  const errors = errorCount > 0 ? `  ${pc.yellow(`${errorCount} err`)}` : "";
  const skipped = skippedCount > 0 && errorCount === 0 ? `  ${pc.dim(`${skippedCount} skip`)}` : "";
  const timing = formatDuration(durationMs).padStart(8);

  console.log(
    `${status}  ${label.padEnd(w)}${pc.dim(files)}  ${pc.dim(items)}${errors}  ${pc.dim(timing)}${skipped}`,
  );
}

// ── Simple status line (for backup sub-steps) ───────────────────────

export function statusLine(icon: string, message: string, timing?: number): void {
  const t = timing != null ? `  ${pc.dim(formatDuration(timing).padStart(8))}` : "";
  console.log(`${icon}  ${message}${t}`);
}

// ── Summary box (wraps consola.box) ─────────────────────────────────

export interface BoxOptions {
  title: string;
  lines: string[];
  borderColor?: string;
}

export function box(opts: BoxOptions): void {
  consola.box({
    title: pc.green(opts.title),
    message: opts.lines.join("\n"),
    style: {
      borderColor: (opts.borderColor ?? "green") as "green",
      marginLeft: 0,
    },
  });
}

// ── Error box ───────────────────────────────────────────────────────

export function errorBox(title: string, lines: string[]): void {
  consola.box({
    title: pc.red(title),
    message: lines.join("\n"),
    style: {
      borderColor: "red" as "red",
      marginLeft: 0,
    },
  });
}

// ── Table with header + separator ───────────────────────────────────

export interface Column {
  label: string;
  align?: "left" | "right";
}

export function table(columns: Column[], rows: string[][]): string {
  if (rows.length === 0) return "";

  // Compute column widths from header + all rows
  const widths = columns.map((col, i) =>
    Math.max(col.label.length, ...rows.map((r) => (r[i] ?? "").length)),
  );

  const pad = (val: string, width: number, align: "left" | "right") =>
    align === "right" ? val.padStart(width) : val.padEnd(width);

  const gap = "  ";
  const headerLine = columns
    .map((col, i) => pc.dim(pad(col.label, widths[i] ?? 0, col.align ?? "left")))
    .join(gap);
  const separator = widths.map((w) => pc.dim("\u2500".repeat(w))).join(gap);
  const dataLines = rows.map((row) =>
    row.map((cell, i) => pad(cell, widths[i] ?? 0, columns[i]?.align ?? "left")).join(gap),
  );

  return [headerLine, separator, ...dataLines].join("\n");
}

// ── Tree rendering ──────────────────────────────────────────────────

export interface TreeChild {
  text: string;
  /** Right-aligned detail (e.g., file size) */
  detail?: string;
  dim?: boolean;
  color?: "yellow" | "green" | "red";
}

export function tree(children: TreeChild[]): string {
  if (children.length === 0) return "";

  const lines: string[] = [];

  // Compute padding for right-aligned details
  const maxTextLen = Math.max(...children.map((c) => c.text.length), 1);
  const detailPad = Math.min(maxTextLen + 4, 50);

  for (const [i, child] of children.entries()) {
    const isLast = i === children.length - 1;
    const branch = isLast ? S.treeLast : S.treeItem;

    let text = child.text;
    if (child.dim) text = pc.dim(text);
    if (child.color === "yellow") text = pc.yellow(text);
    if (child.color === "red") text = pc.red(text);
    if (child.color === "green") text = pc.green(text);

    if (child.detail) {
      const plainTextLen = child.text.length;
      const padding = Math.max(1, detailPad - plainTextLen);
      lines.push(`${S.bar}  ${branch} ${text}${" ".repeat(padding)}${pc.dim(child.detail)}`);
    } else {
      lines.push(`${S.bar}  ${branch} ${text}`);
    }
  }

  return lines.join("\n");
}

// ── Blank line ──────────────────────────────────────────────────────

export function blank(): void {
  console.log();
}

// ── Info / warning / error one-liners ───────────────────────────────

export function info(message: string): void {
  console.log(`${S.info}  ${message}`);
}

export function warn(message: string): void {
  console.log(`${S.warning}  ${pc.yellow(message)}`);
}

export function error(message: string): void {
  console.log(`${S.error}  ${pc.red(message)}`);
}

export function success(message: string): void {
  console.log(`${S.success}  ${message}`);
}

// ── Re-export for convenience ───────────────────────────────────────

export { consola, pc };
