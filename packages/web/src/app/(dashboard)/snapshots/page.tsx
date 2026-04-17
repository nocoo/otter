"use client";

import { Archive, ChevronLeft, ChevronRight, ExternalLink, Monitor, Search } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { formatDateTime, formatSize, formatTimeAgo } from "@/lib/utils";

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
  const router = useRouter();
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
          <h1 className="text-2xl md:text-3xl font-semibold font-display tracking-tight">
            Snapshots
          </h1>
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
          <Button
            variant="link"
            size="sm"
            onClick={() => {
              setCursors([]);
              void fetchPage();
            }}
            className="mt-2 text-xs text-muted-foreground"
          >
            Retry
          </Button>
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
              <Table aria-label="Snapshots list">
                <TableHeader>
                  <TableRow className="border-b border-border">
                    <TableHead className="font-medium text-muted-foreground text-xs">
                      Snapshot
                    </TableHead>
                    <TableHead className="font-medium text-muted-foreground text-xs">
                      Host
                    </TableHead>
                    <TableHead className="font-medium text-muted-foreground text-xs">
                      Platform
                    </TableHead>
                    <TableHead className="font-medium text-muted-foreground text-xs text-right">
                      Collectors
                    </TableHead>
                    <TableHead className="font-medium text-muted-foreground text-xs text-right">
                      Files
                    </TableHead>
                    <TableHead className="font-medium text-muted-foreground text-xs text-right">
                      Lists
                    </TableHead>
                    <TableHead className="font-medium text-muted-foreground text-xs text-right">
                      Size
                    </TableHead>
                    <TableHead className="font-medium text-muted-foreground text-xs text-right">
                      Created
                    </TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {snapshots.map((snap) => (
                    <TableRow
                      key={snap.id}
                      className="group border-b border-border/50 last:border-0 hover:bg-accent/50 focus-within:bg-accent/50 cursor-pointer"
                      onClick={() => router.push(`/snapshots/${snap.id}`)}
                    >
                      <TableCell>
                        <Link
                          href={`/snapshots/${snap.id}`}
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
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center gap-2">
                          <Monitor
                            className="h-3.5 w-3.5 text-muted-foreground"
                            strokeWidth={1.5}
                          />
                          <span className="font-medium">{snap.hostname}</span>
                        </div>
                      </TableCell>
                      <TableCell>
                        <Badge variant="secondary" className="text-xs font-normal">
                          {snap.platform}/{snap.arch}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {snap.collectorCount}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">{snap.fileCount}</TableCell>
                      <TableCell className="text-right tabular-nums">{snap.listCount}</TableCell>
                      <TableCell className="text-right tabular-nums text-muted-foreground">
                        {formatSize(snap.sizeBytes)}
                      </TableCell>
                      <TableCell className="text-right">
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
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </div>

          {/* Pagination */}
          <nav className="flex items-center justify-between px-2" aria-label="Pagination">
            <p className="text-xs text-muted-foreground" aria-live="polite">
              Showing {showStart}-{showEnd} of {total} snapshots
            </p>
            <div className="flex items-center gap-1">
              <Button
                variant="ghost"
                size="icon"
                disabled={currentPage === 1}
                onClick={currentPage === 2 ? handlePrevToFirst : handlePrev}
                aria-label="Previous page"
              >
                <ChevronLeft className="h-4 w-4" aria-hidden="true" />
              </Button>
              <span className="px-2 text-xs text-muted-foreground" aria-current="page">
                Page {currentPage} of {totalPages}
              </span>
              <Button
                variant="ghost"
                size="icon"
                disabled={nextBefore === null}
                onClick={handleNext}
                aria-label="Next page"
              >
                <ChevronRight className="h-4 w-4" aria-hidden="true" />
              </Button>
            </div>
          </nav>
        </>
      )}
    </div>
  );
}
