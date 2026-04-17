"use client";

import {
  Archive,
  ArrowRight,
  Clock,
  ExternalLink,
  FileText,
  Monitor,
  TrendingUp,
  Webhook,
} from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { AreaChart, type AreaChartDataPoint } from "@/components/charts";
import { DashboardSegment } from "@/components/dashboard/dashboard-segment";
import { StatCard, StatGrid } from "@/components/dashboard/stat-card";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { formatSize, formatTimeAgo } from "@/lib/utils";

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

interface WebhookRow {
  id: string;
  token: string;
  label: string;
  isActive: boolean;
  createdAt: number;
  lastUsedAt: number | null;
}

interface DashboardData {
  snapshots: SnapshotRow[];
  allSnapshots: SnapshotRow[]; // For trend aggregation
  totalSnapshots: number;
  webhooks: WebhookRow[];
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Aggregate snapshots into daily counts for the last 7 days */
function aggregateSnapshotsByDay(snapshots: SnapshotRow[]): AreaChartDataPoint[] {
  const now = Date.now();
  const sevenDaysAgo = now - 7 * 24 * 60 * 60 * 1000;
  const days: { [key: string]: number } = {};

  // Initialize last 7 days with 0
  for (let i = 6; i >= 0; i--) {
    const date = new Date(now - i * 24 * 60 * 60 * 1000);
    const key = date.toLocaleDateString("en-US", { weekday: "short" });
    days[key] = 0;
  }

  // Count snapshots per day
  for (const snap of snapshots) {
    if (snap.snapshotAt >= sevenDaysAgo) {
      const date = new Date(snap.snapshotAt);
      const key = date.toLocaleDateString("en-US", { weekday: "short" });
      if (key in days) {
        days[key] = (days[key] ?? 0) + 1;
      }
    }
  }

  // Convert to ordered array
  const result: AreaChartDataPoint[] = [];
  for (let i = 6; i >= 0; i--) {
    const date = new Date(now - i * 24 * 60 * 60 * 1000);
    const key = date.toLocaleDateString("en-US", { weekday: "short" });
    result.push({ label: key, value: days[key] ?? 0 });
  }
  return result;
}

// ---------------------------------------------------------------------------
// Components
// ---------------------------------------------------------------------------

function StatCardSkeleton() {
  return (
    <div className="rounded-[var(--radius-card)] bg-secondary p-4 md:p-5 space-y-3">
      <div className="flex items-center justify-between">
        <Skeleton className="h-3 w-20" />
        <Skeleton className="h-9 w-9 rounded-md" />
      </div>
      <Skeleton className="h-7 w-28" />
    </div>
  );
}

function DashboardSkeleton() {
  return (
    <div className="space-y-6">
      {/* Stats Cards Skeleton */}
      <StatGrid columns={4}>
        <StatCardSkeleton />
        <StatCardSkeleton />
        <StatCardSkeleton />
        <StatCardSkeleton />
      </StatGrid>

      {/* Two-column layout skeleton */}
      <div className="grid gap-4 lg:grid-cols-3">
        {/* Recent Snapshots skeleton (2/3 width) */}
        <div className="lg:col-span-2 rounded-[var(--radius-card)] bg-secondary p-4 md:p-5">
          <div className="flex items-center justify-between mb-4">
            <Skeleton className="h-4 w-32" />
            <Skeleton className="h-4 w-16" />
          </div>
          <div className="space-y-3">
            {[1, 2, 3, 4, 5].map((i) => (
              <div key={i} className="flex items-center gap-4">
                <Skeleton className="h-4 w-24" />
                <Skeleton className="h-4 w-20" />
                <Skeleton className="h-4 w-12 ml-auto" />
                <Skeleton className="h-4 w-12" />
                <Skeleton className="h-4 w-16" />
                <Skeleton className="h-4 w-14" />
              </div>
            ))}
          </div>
        </div>

        {/* Backup Trend skeleton (1/3 width) */}
        <div className="rounded-[var(--radius-card)] bg-secondary p-4 md:p-5">
          <Skeleton className="h-4 w-28 mb-4" />
          <Skeleton className="h-[160px] w-full rounded" />
        </div>
      </div>
    </div>
  );
}

// biome-ignore lint/complexity/noExcessiveCognitiveComplexity: dashboard page with multiple render states
export default function DashboardPage() {
  const router = useRouter();
  const [data, setData] = useState<DashboardData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    // biome-ignore lint/complexity/noExcessiveCognitiveComplexity: multi-step fetch with error handling
    async function fetchDashboard() {
      setLoading(true);
      try {
        const [snapshotsRes, recentSnapshotsRes, webhooksRes] = await Promise.all([
          fetch("/api/snapshots?limit=50"), // For trend aggregation
          fetch("/api/snapshots?limit=5"), // For recent list
          fetch("/api/webhooks"),
        ]);

        if (!snapshotsRes.ok) {
          const body = await snapshotsRes.json().catch(() => null);
          throw new Error(body?.error ?? `Failed to load snapshots (${snapshotsRes.status})`);
        }
        if (!recentSnapshotsRes.ok) {
          const body = await recentSnapshotsRes.json().catch(() => null);
          throw new Error(body?.error ?? `Failed to load snapshots (${recentSnapshotsRes.status})`);
        }
        if (!webhooksRes.ok) {
          const body = await webhooksRes.json().catch(() => null);
          throw new Error(body?.error ?? `Failed to load webhooks (${webhooksRes.status})`);
        }

        const snapshotsData = await snapshotsRes.json();
        const recentSnapshotsData = await recentSnapshotsRes.json();
        const webhooksData = await webhooksRes.json();

        setData({
          snapshots: recentSnapshotsData.snapshots,
          allSnapshots: snapshotsData.snapshots,
          totalSnapshots: snapshotsData.total,
          webhooks: webhooksData.webhooks,
        });
        setError(null);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Unknown error");
      } finally {
        setLoading(false);
      }
    }
    void fetchDashboard();
  }, []);

  const latest = data?.snapshots[0] ?? null;
  const activeWebhooks = data?.webhooks.filter((w) => w.isActive).length ?? 0;

  // Aggregate snapshots by day for the trend chart
  const trendData = aggregateSnapshotsByDay(data?.allSnapshots ?? []);

  return (
    <div className="space-y-4 md:space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-2xl md:text-3xl font-semibold font-display tracking-tight">
          Dashboard
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Overview of your dev environment backups
        </p>
      </div>

      {/* Loading skeleton */}
      {loading ? (
        <DashboardSkeleton />
      ) : error ? (
        <div className="rounded-[var(--radius-card)] bg-secondary p-12 text-center">
          <p className="text-sm text-destructive">{error}</p>
          <button
            type="button"
            onClick={() => window.location.reload()}
            className="mt-2 text-xs text-muted-foreground hover:text-foreground underline"
          >
            Retry
          </button>
        </div>
      ) : (
        <>
          {/* ── Overview ────────────────────────────────────── */}
          <DashboardSegment title="Overview">
            <StatGrid columns={4}>
              <StatCard
                title="Total Snapshots"
                value={data ? String(data.totalSnapshots) : "–"}
                subtitle="All time"
                icon={Archive}
                iconColor="text-primary"
                variant="primary"
                accentColor="bg-gradient-to-r from-primary to-chart-8"
              />
              <StatCard
                title="Active Webhooks"
                value={data ? String(activeWebhooks) : "–"}
                subtitle="Ready to receive"
                icon={Webhook}
                accentColor="bg-chart-3"
              />
              <StatCard
                title="Config Files"
                value={latest ? String(latest.fileCount) : "–"}
                subtitle="Latest backup"
                icon={FileText}
                accentColor="bg-chart-5"
              />
              <StatCard
                title="Last Backup"
                value={latest ? formatTimeAgo(latest.snapshotAt) : "–"}
                subtitle={latest ? `${formatSize(latest.sizeBytes)}` : "No backups"}
                icon={Clock}
                accentColor="bg-chart-6"
              />
            </StatGrid>
          </DashboardSegment>

          {/* ── Activity ────────────────────────────────────── */}
          <DashboardSegment title="Activity">
            <div className="grid gap-4 lg:grid-cols-3">
              {/* Recent Snapshots (2/3 width) */}
              <div className="lg:col-span-2 rounded-[var(--radius-card)] bg-secondary p-4 md:p-5">
                <div className="flex items-center justify-between mb-4">
                  <h3 className="text-sm font-medium text-foreground">Recent Snapshots</h3>
                  <Link
                    href="/snapshots"
                    className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
                  >
                    View all <ArrowRight className="h-3 w-3" />
                  </Link>
                </div>
                {data && data.snapshots.length === 0 ? (
                  <div className="py-6 text-center">
                    <Archive
                      className="h-8 w-8 text-muted-foreground/40 mx-auto"
                      strokeWidth={1.5}
                    />
                    <p className="mt-3 text-sm text-muted-foreground">No snapshots yet</p>
                    <p className="mt-1 text-xs text-muted-foreground/60">
                      Configure a webhook and run the CLI to create your first backup
                    </p>
                  </div>
                ) : (
                  <div className="overflow-x-auto">
                    <Table aria-label="Recent snapshots">
                      <TableHeader>
                        <TableRow className="border-b border-border">
                          <TableHead className="font-medium text-muted-foreground text-xs">
                            Host
                          </TableHead>
                          <TableHead className="font-medium text-muted-foreground text-xs">
                            Platform
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
                            When
                          </TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {data?.snapshots.map((snap) => (
                          <TableRow
                            key={snap.id}
                            className="group border-b border-border/50 last:border-0 hover:bg-accent/50 focus-within:bg-accent/50 cursor-pointer"
                            onClick={() => router.push(`/snapshots/${snap.id}`)}
                          >
                            <TableCell>
                              <Link
                                href={`/snapshots/${snap.id}`}
                                className="flex items-center gap-2 group-hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 rounded transition-colors"
                                onClick={(e) => e.stopPropagation()}
                                aria-label={`View snapshot from ${snap.hostname}`}
                              >
                                <Monitor
                                  className="h-3.5 w-3.5 text-muted-foreground group-hover:text-primary transition-colors"
                                  strokeWidth={1.5}
                                  aria-hidden="true"
                                />
                                <span className="font-medium">{snap.hostname}</span>
                              </Link>
                            </TableCell>
                            <TableCell className="text-muted-foreground">
                              {snap.platform}/{snap.arch}
                            </TableCell>
                            <TableCell className="text-right tabular-nums">
                              {snap.fileCount}
                            </TableCell>
                            <TableCell className="text-right tabular-nums">
                              {snap.listCount}
                            </TableCell>
                            <TableCell className="text-right tabular-nums text-muted-foreground">
                              {formatSize(snap.sizeBytes)}
                            </TableCell>
                            <TableCell className="text-right">
                              <div className="flex items-center justify-end gap-2">
                                <span className="text-muted-foreground text-xs">
                                  {formatTimeAgo(snap.snapshotAt)}
                                </span>
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
                )}
              </div>

              {/* Backup Trend (1/3 width) */}
              <div className="rounded-[var(--radius-card)] bg-secondary p-4 md:p-5">
                <div className="flex items-center gap-2 mb-3">
                  <TrendingUp className="h-4 w-4 text-primary" strokeWidth={1.5} />
                  <h3 className="text-sm font-medium text-foreground">Backup Trend</h3>
                </div>
                <p className="text-xs text-muted-foreground mb-3">Last 7 days</p>
                <AreaChart
                  data={trendData}
                  height={160}
                  showGrid={false}
                  ariaLabel="Backup trend over the last 7 days"
                />
              </div>
            </div>
          </DashboardSegment>
        </>
      )}
    </div>
  );
}
