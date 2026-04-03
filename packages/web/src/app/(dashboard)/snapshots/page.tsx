"use client";

import { Archive, ChevronLeft, ChevronRight, Monitor, Search } from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { formatSize } from "@/lib/utils";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatTimeAgo(ts: number): string {
  const diff = Date.now() - ts;
  const minutes = Math.floor(diff / 60000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d ago`;
  if (days < 30) return `${Math.floor(days / 7)}w ago`;
  if (days < 365) return `${Math.floor(days / 30)}mo ago`;
  return `${Math.floor(days / 365)}y ago`;
}

function formatDateTime(ts: number): string {
  return new Date(ts).toLocaleString("en-US", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const PAGE_SIZE = 20;

// ---------------------------------------------------------------------------
// Skeleton
// ---------------------------------------------------------------------------

function SnapshotsPageSkeleton() {
  return (
    <div className="space-y-6">
      {/* Header skeleton */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <Skeleton className="h-8 w-32" />
          <Skeleton className="h-4 w-64 mt-2" />
        </div>
        <Skeleton className="h-10 w-full sm:w-64" />
      </div>

      {/* Table skeleton */}
      <div className="rounded-xl bg-secondary p-1">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border">
                <th className="px-4 py-3 text-left">
                  <Skeleton className="h-3 w-16" />
                </th>
                <th className="px-4 py-3 text-left">
                  <Skeleton className="h-3 w-10" />
                </th>
                <th className="px-4 py-3 text-left">
                  <Skeleton className="h-3 w-16" />
                </th>
                <th className="px-4 py-3 text-right">
                  <Skeleton className="h-3 w-16 ml-auto" />
                </th>
                <th className="px-4 py-3 text-right">
                  <Skeleton className="h-3 w-10 ml-auto" />
                </th>
                <th className="px-4 py-3 text-right">
                  <Skeleton className="h-3 w-10 ml-auto" />
                </th>
                <th className="px-4 py-3 text-right">
                  <Skeleton className="h-3 w-10 ml-auto" />
                </th>
                <th className="px-4 py-3 text-right">
                  <Skeleton className="h-3 w-16 ml-auto" />
                </th>
              </tr>
            </thead>
            <tbody>
              {Array.from({ length: 5 }).map((_, i) => (
                // biome-ignore lint/suspicious/noArrayIndexKey: skeleton rows are static, never reorder
                <tr key={`skeleton-row-${i}`} className="border-b border-border/50 last:border-0">
                  <td className="px-4 py-3">
                    <Skeleton className="h-4 w-20" />
                  </td>
                  <td className="px-4 py-3">
                    <Skeleton className="h-4 w-24" />
                  </td>
                  <td className="px-4 py-3">
                    <Skeleton className="h-5 w-20 rounded-full" />
                  </td>
                  <td className="px-4 py-3 text-right">
                    <Skeleton className="h-4 w-6 ml-auto" />
                  </td>
                  <td className="px-4 py-3 text-right">
                    <Skeleton className="h-4 w-8 ml-auto" />
                  </td>
                  <td className="px-4 py-3 text-right">
                    <Skeleton className="h-4 w-6 ml-auto" />
                  </td>
                  <td className="px-4 py-3 text-right">
                    <Skeleton className="h-4 w-12 ml-auto" />
                  </td>
                  <td className="px-4 py-3 text-right">
                    <Skeleton className="h-3 w-12 ml-auto" />
                    <Skeleton className="h-2 w-20 ml-auto mt-1" />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Pagination skeleton */}
      <div className="flex items-center justify-between px-2">
        <Skeleton className="h-4 w-40" />
        <Skeleton className="h-8 w-32" />
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Components
// ---------------------------------------------------------------------------

export default function SnapshotsPage() {
  const [snapshots, setSnapshots] = useState<SnapshotRow[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [cursors, setCursors] = useState<number[]>([]); // stack of "before" cursors for back navigation
  const [nextBefore, setNextBefore] = useState<number | null>(null);

  const fetchPage = useCallback(async (before?: number) => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ limit: String(PAGE_SIZE) });
      if (before !== undefined) {
        params.set("before", String(before));
      }
      const res = await fetch(`/api/snapshots?${params.toString()}`);
      if (!res.ok) {
        const body = await res.json().catch(() => null);
        throw new Error(body?.error ?? `Failed to load snapshots (${res.status})`);
      }
      const data = await res.json();
      setSnapshots(data.snapshots);
      setTotal(data.total);
      setNextBefore(data.nextBefore);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unknown error");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void fetchPage();
  }, [fetchPage]);

  const currentPage = cursors.length + 1;
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const showStart = total === 0 ? 0 : (currentPage - 1) * PAGE_SIZE + 1;
  const showEnd = Math.min(currentPage * PAGE_SIZE, total);

  const handleNext = () => {
    if (nextBefore === null) return;
    // Push current first item's uploadedAt as cursor for "back"
    if (snapshots.length > 0) {
      const first = snapshots[0];
      if (first) setCursors((prev) => [...prev, first.uploadedAt + 1]);
    }
    void fetchPage(nextBefore);
  };

  const handlePrev = () => {
    if (cursors.length === 0) return;
    const newCursors = [...cursors];
    newCursors.pop();
    setCursors(newCursors);
    const prevBefore = newCursors.length > 0 ? newCursors[newCursors.length - 1] : undefined;
    // Go back to the first page if no cursor
    void fetchPage(prevBefore !== undefined ? prevBefore - 1 : undefined);
  };

  // For back navigation, we refetch without cursor if it's page 1
  const handlePrevToFirst = () => {
    setCursors([]);
    void fetchPage();
  };

  return (
    <div className="space-y-6">
      {/* Header */}
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

      {/* Content */}
      {loading ? (
        <SnapshotsPageSkeleton />
      ) : error ? (
        <div className="rounded-xl bg-secondary p-12 text-center">
          <p className="text-sm text-destructive">{error}</p>
          <button
            type="button"
            onClick={() => {
              setCursors([]);
              void fetchPage();
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
          {/* Table */}
          <div className="rounded-xl bg-secondary p-1">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
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
                      className="border-b border-border/50 last:border-0 hover:bg-accent/50 transition-colors"
                    >
                      <td className="px-4 py-3">
                        <Link
                          href={`/snapshots/${snap.id}`}
                          className="inline-flex items-center gap-2 text-foreground hover:text-primary transition-colors"
                        >
                          <Archive
                            className="h-3.5 w-3.5 text-muted-foreground"
                            strokeWidth={1.5}
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
                        <div className="flex flex-col items-end">
                          <span className="text-xs text-muted-foreground">
                            {formatTimeAgo(snap.snapshotAt)}
                          </span>
                          <span className="text-[10px] text-muted-foreground/60">
                            {formatDateTime(snap.snapshotAt)}
                          </span>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {/* Pagination */}
          <div className="flex items-center justify-between px-2">
            <p className="text-xs text-muted-foreground">
              Showing {showStart}-{showEnd} of {total} snapshots
            </p>
            <div className="flex items-center gap-1">
              <button
                type="button"
                disabled={currentPage === 1}
                onClick={currentPage === 2 ? handlePrevToFirst : handlePrev}
                className="flex h-8 w-8 items-center justify-center rounded-lg text-muted-foreground hover:text-foreground disabled:opacity-40 transition-colors"
              >
                <ChevronLeft className="h-4 w-4" />
              </button>
              <span className="px-2 text-xs text-muted-foreground">
                Page {currentPage} of {totalPages}
              </span>
              <button
                type="button"
                disabled={nextBefore === null}
                onClick={handleNext}
                className="flex h-8 w-8 items-center justify-center rounded-lg text-muted-foreground hover:text-foreground disabled:opacity-40 transition-colors"
              >
                <ChevronRight className="h-4 w-4" />
              </button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
