export interface SnapshotFileData {
  path: string;
  sizeBytes: number;
  content?: string;
}

export interface SnapshotListItem {
  name: string;
  version?: string;
  meta?: Record<string, string>;
}

export interface SnapshotCollector {
  id: string;
  label: string;
  category: string;
  files: SnapshotFileData[];
  lists: SnapshotListItem[];
  errors: string[];
  skipped?: string[];
}

export interface CollectorFilterState {
  query: string;
  category: string;
}

export interface CollectorOverview {
  total: number;
  visible: number;
  config: number;
  environment: number;
  withErrors: number;
}

export interface CollectorGroup {
  category: string;
  collectors: SnapshotCollector[];
  totalFiles: number;
  totalLists: number;
  withErrors: number;
}

function normalize(value: string): string {
  return value.trim().toLowerCase();
}

export function matchesCollectorQuery(collector: SnapshotCollector, rawQuery: string): boolean {
  const query = normalize(rawQuery);
  if (!query) return true;

  const searchable = [
    collector.id,
    collector.label,
    collector.category,
    ...collector.files.map((file) => file.path),
    ...collector.lists.flatMap((item) => [
      item.name,
      item.version ?? "",
      ...Object.entries(item.meta ?? {}).flat(),
    ]),
    ...collector.errors,
    ...(collector.skipped ?? []),
  ]
    .join(" ")
    .toLowerCase();

  return searchable.includes(query);
}

export function filterCollectors(
  collectors: SnapshotCollector[],
  filters: CollectorFilterState,
): SnapshotCollector[] {
  return collectors.filter((collector) => {
    const matchesCategory = filters.category === "all" || collector.category === filters.category;
    return matchesCategory && matchesCollectorQuery(collector, filters.query);
  });
}

export function getCollectorOverview(
  collectors: SnapshotCollector[],
  visibleCollectors: SnapshotCollector[],
): CollectorOverview {
  return {
    total: collectors.length,
    visible: visibleCollectors.length,
    config: collectors.filter((collector) => collector.category === "config").length,
    environment: collectors.filter((collector) => collector.category === "environment").length,
    withErrors: collectors.filter((collector) => collector.errors.length > 0).length,
  };
}

export function groupCollectorsByCategory(collectors: SnapshotCollector[]): CollectorGroup[] {
  const grouped = new Map<string, SnapshotCollector[]>();

  for (const collector of collectors) {
    const current = grouped.get(collector.category) ?? [];
    current.push(collector);
    grouped.set(collector.category, current);
  }

  return Array.from(grouped.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([category, items]) => ({
      category,
      collectors: items.sort((a, b) => a.label.localeCompare(b.label)),
      totalFiles: items.reduce((sum, collector) => sum + collector.files.length, 0),
      totalLists: items.reduce((sum, collector) => sum + collector.lists.length, 0),
      withErrors: items.filter((collector) => collector.errors.length > 0).length,
    }));
}
