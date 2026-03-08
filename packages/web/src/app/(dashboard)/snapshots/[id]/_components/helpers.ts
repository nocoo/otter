import type { ListItem } from "./types";

export function formatDateTime(ts: number): string {
  return new Date(ts).toLocaleString("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

const ICON_BASE_URL = "https://s.zhe.to/apps/otter";

/**
 * Resolve the icon URL for a list item.
 * Uses meta.iconUrl if present, otherwise falls back to computing
 * a deterministic URL from the app name (for legacy snapshots).
 */
export async function computeIconUrl(appName: string): Promise<string> {
  const data = new TextEncoder().encode(appName);
  const hashBuffer = await crypto.subtle.digest("SHA-256", data);
  const hex = Array.from(new Uint8Array(hashBuffer))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
  return `${ICON_BASE_URL}/${hex.slice(0, 12)}.png`;
}

export function resolveIconUrl(item: ListItem): string | undefined {
  return item.meta?.iconUrl;
}

export function metaEntries(meta?: Record<string, string>): Array<[string, string]> {
  if (!meta) return [];
  return Object.entries(meta).filter(([key]) => key !== "iconUrl");
}

export function formatMetaLabel(key: string): string {
  return key.replace(/[-_]/g, " ");
}

/**
 * Semantic badge color classes based on meta key meaning.
 * Uses design-system-aligned colors instead of hardcoded values.
 */
export function badgeClassName(key: string): string {
  if (key === "pinned" || key === "default" || key === "current") {
    return "border-success/30 bg-success/10 text-success";
  }
  if (key === "type") {
    return "border-info/30 bg-info/10 text-info";
  }
  return "";
}

export function listItemKey(item: ListItem, index: number): string {
  const meta = item.meta
    ? Object.entries(item.meta)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([key, value]) => `${key}:${value}`)
        .join("|")
    : "";

  return [item.name, item.version ?? "", meta, String(index)].join("::");
}
