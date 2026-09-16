import { Archive, ChevronLeft, ChevronRight, ExternalLink, Monitor, Search } from "lucide-react";
import { useState } from "react";
import { Link, useNavigate } from "react-router";
import { useApi } from "@/api";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { formatDateTime, formatSize, formatTimeAgo } from "@/lib/utils";

interface SnapshotRow {
  id: string;
  hostname: string;
  platform: string;
  arch: string;
  username: string;
  collectorCount: number;
  fileCount: number;
  listCount: number;
  sizeBytes: number;
  snapshotAt: number;
  uploadedAt: number;
}

interface SnapshotsResponse {
  snapshots: SnapshotRow[];
  total: number;
  nextBefore: number | null;
}

const PAGE_SIZE = 20;

function SnapshotsPageSkeleton() {
  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <Skeleton className="h-8 w-32" />
          <Skeleton className="h-4 w-64 mt-2" />
        </div>
        <Skeleton className="h-10 w-full sm:w-64" />
      </div>

      <div className="rounded-xl bg-secondary p-1">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border">
                {Array.from({ length: 8 }).map((_, i) => (
                  // biome-ignore lint/suspicious/noArrayIndexKey: skeleton header cells static
                  <th key={`skeleton-th-${i}`} className="px-4 py-3">
                    <Skeleton className="h-3 w-12" />
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {Array.from({ length: 5 }).map((_, i) => (
                // biome-ignore lint/suspicious/noArrayIndexKey: skeleton rows static
                <tr key={`skeleton-row-${i}`} className="border-b border-border/50 last:border-0">
                  {Array.from({ length: 8 }).map((__, j) => (
                    // biome-ignore lint/suspicious/noArrayIndexKey: skeleton cells static
                    <td key={`skeleton-td-${i}-${j}`} className="px-4 py-3">
                      <Skeleton className="h-4 w-16" />
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

function buildKey(before: number | undefined): string {
  const params = new URLSearchParams({ limit: String(PAGE_SIZE) });
  if (before !== undefined) params.set("before", String(before));
  return `/api/snapshots?${params.toString()}`;
}

export function SnapshotsPage() {
  const navigate = useNavigate();
  const [cursorStack, setCursorStack] = useState<(number | undefined)[]>([undefined]);
  const currentBefore = cursorStack[cursorStack.length - 1];
  const { data, error, isLoading, mutate } = useApi<SnapshotsResponse>(buildKey(currentBefore));

  const snapshots = data?.snapshots ?? [];
  const total = data?.total ?? 0;
  const nextBefore = data?.nextBefore ?? null;

  const currentPage = cursorStack.length;
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const showStart = total === 0 ? 0 : (currentPage - 1) * PAGE_SIZE + 1;
  const showEnd = Math.min(currentPage * PAGE_SIZE, total);

  const handleNext = () => {
    if (nextBefore === null) return;
    setCursorStack((prev) => [...prev, nextBefore]);
  };

  const handlePrev = () => {
    if (cursorStack.length <= 1) return;
    setCursorStack((prev) => prev.slice(0, -1));
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Snapshots</h1>
          <p className="text-sm text-muted-foreground">Browse all dev environment backups</p>
        </div>
        <div className="relative w-full sm:w-64">
          <Search
            className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground"
            strokeWidth={1.5}
          />
          <Input placeholder="Search by hostname..." className="pl-9" disabled />
        </div>
      </div>

      {isLoading && !data ? (
        <SnapshotsPageSkeleton />
      ) : error ? (
        <div className="rounded-xl bg-secondary p-12 text-center">
          <p className="text-sm text-destructive">Failed to load snapshots</p>
          <button
            type="button"
            onClick={() => {
              setCursorStack([undefined]);
              void mutate();
            }}
            className="mt-2 text-xs text-muted-foreground hover:text-foreground underline"
          >
            Retry
          </button>
        </div>
      ) : snapshots.length === 0 ? (
        <div className="rounded-xl bg-secondary p-12 text-center">
          <Archive className="h-8 w-8 text-muted-foreground/40 mx-auto" strokeWidth={1.5} />
          <p className="mt-3 text-sm text-muted-foreground">No snapshots yet</p>
          <p className="mt-1 text-xs text-muted-foreground/60">
            Configure a webhook and run the CLI to create your first backup
          </p>
        </div>
      ) : (
        <>
          <div className="rounded-xl bg-secondary p-1">
            <div className="overflow-x-auto">
              <table className="w-full text-sm" aria-label="Snapshots list">
                <thead>
                  <tr className="border-b border-border">
                    <th className="px-4 py-3 text-left font-medium text-muted-foreground text-xs">
                      Snapshot
                    </th>
                    <th className="px-4 py-3 text-left font-medium text-muted-foreground text-xs">
                      Host
                    </th>
                    <th className="px-4 py-3 text-left font-medium text-muted-foreground text-xs">
                      Platform
                    </th>
                    <th className="px-4 py-3 text-right font-medium text-muted-foreground text-xs">
                      Collectors
                    </th>
                    <th className="px-4 py-3 text-right font-medium text-muted-foreground text-xs">
                      Files
                    </th>
                    <th className="px-4 py-3 text-right font-medium text-muted-foreground text-xs">
                      Lists
                    </th>
                    <th className="px-4 py-3 text-right font-medium text-muted-foreground text-xs">
                      Size
                    </th>
                    <th className="px-4 py-3 text-right font-medium text-muted-foreground text-xs">
                      Created
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {snapshots.map((snap) => (
                    <tr
                      key={snap.id}
                      className="group border-b border-border/50 last:border-0 hover:bg-accent/50 focus-within:bg-accent/50 transition-colors cursor-pointer"
                      onClick={() => navigate(`/snapshots/${snap.id}`)}
                    >
                      <td className="px-4 py-3">
                        <Link
                          to={`/snapshots/${snap.id}`}
                          className="inline-flex items-center gap-2 text-foreground group-hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 rounded transition-colors"
                          onClick={(e) => e.stopPropagation()}
                          aria-label={`View snapshot ${snap.id.slice(0, 8)} from ${snap.hostname}`}
                        >
                          <Archive
                            className="h-3.5 w-3.5 text-muted-foreground group-hover:text-primary transition-colors"
                            strokeWidth={1.5}
                            aria-hidden="true"
                          />
                          <code className="text-xs font-mono">{snap.id.slice(0, 8)}</code>
                        </Link>
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-2">
                          <Monitor
                            className="h-3.5 w-3.5 text-muted-foreground"
                            strokeWidth={1.5}
                          />
                          <span className="font-medium">{snap.hostname}</span>
                        </div>
                      </td>
                      <td className="px-4 py-3">
                        <Badge variant="secondary" className="text-xs font-normal">
                          {snap.platform}/{snap.arch}
                        </Badge>
                      </td>
                      <td className="px-4 py-3 text-right tabular-nums">{snap.collectorCount}</td>
                      <td className="px-4 py-3 text-right tabular-nums">{snap.fileCount}</td>
                      <td className="px-4 py-3 text-right tabular-nums">{snap.listCount}</td>
                      <td className="px-4 py-3 text-right tabular-nums text-muted-foreground">
                        {formatSize(snap.sizeBytes)}
                      </td>
                      <td className="px-4 py-3 text-right">
                        <div className="flex items-center justify-end gap-2">
                          <div className="flex flex-col items-end">
                            <span className="text-xs text-muted-foreground">
                              {formatTimeAgo(snap.snapshotAt)}
                            </span>
                            <span className="text-2xs text-muted-foreground/60">
                              {formatDateTime(snap.snapshotAt)}
                            </span>
                          </div>
                          <ExternalLink
                            className="h-3.5 w-3.5 text-muted-foreground/0 group-hover:text-muted-foreground transition-colors"
                            strokeWidth={1.5}
                          />
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          <nav className="flex items-center justify-between px-2" aria-label="Pagination">
            <p className="text-xs text-muted-foreground" aria-live="polite">
              Showing {showStart}-{showEnd} of {total} snapshots
            </p>
            <div className="flex items-center gap-1">
              <button
                type="button"
                disabled={currentPage === 1}
                onClick={handlePrev}
                className="flex h-8 w-8 min-h-11 min-w-11 sm:min-h-0 sm:min-w-0 items-center justify-center rounded-lg text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-40 transition-colors"
                aria-label="Previous page"
              >
                <ChevronLeft className="h-4 w-4" aria-hidden="true" />
              </button>
              <span className="px-2 text-xs text-muted-foreground" aria-current="page">
                Page {currentPage} of {totalPages}
              </span>
              <button
                type="button"
                disabled={nextBefore === null}
                onClick={handleNext}
                className="flex h-8 w-8 min-h-11 min-w-11 sm:min-h-0 sm:min-w-0 items-center justify-center rounded-lg text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-40 transition-colors"
                aria-label="Next page"
              >
                <ChevronRight className="h-4 w-4" aria-hidden="true" />
              </button>
            </div>
          </nav>
        </>
      )}
    </div>
  );
}
