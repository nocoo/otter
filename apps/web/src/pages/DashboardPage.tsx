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
import { Link, useNavigate } from "react-router";
import { useApi } from "@/api";
import { AreaChart, type AreaChartDataPoint } from "@/components/charts";
import { DashboardSegment } from "@/components/dashboard/dashboard-segment";
import { StatCard, StatGrid } from "@/components/dashboard/stat-card";
import { Skeleton } from "@/components/ui/skeleton";
import { formatSize, formatTimeAgo } from "@/lib/utils";

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

interface SnapshotsResponse {
  snapshots: SnapshotRow[];
  total: number;
}

interface WebhooksResponse {
  webhooks: WebhookRow[];
}

function aggregateSnapshotsByDay(snapshots: SnapshotRow[]): AreaChartDataPoint[] {
  const now = Date.now();
  const sevenDaysAgo = now - 7 * 24 * 60 * 60 * 1000;
  const days: { [key: string]: number } = {};

  for (let i = 6; i >= 0; i--) {
    const date = new Date(now - i * 24 * 60 * 60 * 1000);
    const key = date.toLocaleDateString("en-US", { weekday: "short" });
    days[key] = 0;
  }

  for (const snap of snapshots) {
    if (snap.snapshotAt >= sevenDaysAgo) {
      const date = new Date(snap.snapshotAt);
      const key = date.toLocaleDateString("en-US", { weekday: "short" });
      if (key in days) {
        days[key] = (days[key] ?? 0) + 1;
      }
    }
  }

  const result: AreaChartDataPoint[] = [];
  for (let i = 6; i >= 0; i--) {
    const date = new Date(now - i * 24 * 60 * 60 * 1000);
    const key = date.toLocaleDateString("en-US", { weekday: "short" });
    result.push({ label: key, value: days[key] ?? 0 });
  }
  return result;
}

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
      <StatGrid columns={4}>
        <StatCardSkeleton />
        <StatCardSkeleton />
        <StatCardSkeleton />
        <StatCardSkeleton />
      </StatGrid>

      <div className="grid gap-4 lg:grid-cols-3">
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

        <div className="rounded-[var(--radius-card)] bg-secondary p-4 md:p-5">
          <Skeleton className="h-4 w-28 mb-4" />
          <Skeleton className="h-[160px] w-full rounded" />
        </div>
      </div>
    </div>
  );
}

// biome-ignore lint/complexity/noExcessiveCognitiveComplexity: dashboard page with multiple render states
export function DashboardPage() {
  const navigate = useNavigate();
  const {
    data: trendSnaps,
    error: trendErr,
    isLoading: trendLoading,
  } = useApi<SnapshotsResponse>("/api/snapshots?limit=50");
  const {
    data: recentSnaps,
    error: recentErr,
    isLoading: recentLoading,
  } = useApi<SnapshotsResponse>("/api/snapshots?limit=5");
  const {
    data: webhooksData,
    error: hookErr,
    isLoading: hookLoading,
  } = useApi<WebhooksResponse>("/api/webhooks");

  const loading = trendLoading || recentLoading || hookLoading;
  const error = trendErr ?? recentErr ?? hookErr;

  const snapshots = recentSnaps?.snapshots ?? [];
  const allSnapshots = trendSnaps?.snapshots ?? [];
  const totalSnapshots = trendSnaps?.total ?? 0;
  const webhooks = webhooksData?.webhooks ?? [];

  const latest = snapshots[0] ?? null;
  const activeWebhooks = webhooks.filter((w) => w.isActive).length;
  const trendData = aggregateSnapshotsByDay(allSnapshots);

  return (
    <div className="space-y-4 md:space-y-6">
      <div>
        <h1 className="text-2xl md:text-3xl font-semibold font-display tracking-tight">
          Dashboard
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Overview of your dev environment backups
        </p>
      </div>

      {loading ? (
        <DashboardSkeleton />
      ) : error ? (
        <div className="rounded-[var(--radius-card)] bg-secondary p-12 text-center">
          <p className="text-sm text-destructive">
            {error instanceof Error ? error.message : "Failed to load dashboard"}
          </p>
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
          <DashboardSegment title="Overview">
            <StatGrid columns={4}>
              <StatCard
                title="Total Snapshots"
                value={String(totalSnapshots)}
                subtitle="All time"
                icon={Archive}
                iconColor="text-primary"
                variant="primary"
                accentColor="bg-gradient-to-r from-primary to-chart-8"
              />
              <StatCard
                title="Active Webhooks"
                value={String(activeWebhooks)}
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

          <DashboardSegment title="Activity">
            <div className="grid gap-4 lg:grid-cols-3">
              <div className="lg:col-span-2 rounded-[var(--radius-card)] bg-secondary p-4 md:p-5">
                <div className="flex items-center justify-between mb-4">
                  <h3 className="text-sm font-medium text-foreground">Recent Snapshots</h3>
                  <Link
                    to="/snapshots"
                    className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
                  >
                    View all <ArrowRight className="h-3 w-3" />
                  </Link>
                </div>
                {snapshots.length === 0 ? (
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
                    <table className="w-full text-sm" aria-label="Recent snapshots">
                      <thead>
                        <tr className="border-b border-border text-left">
                          <th className="pb-2 pr-4 font-medium text-muted-foreground text-xs">
                            Host
                          </th>
                          <th className="pb-2 pr-4 font-medium text-muted-foreground text-xs">
                            Platform
                          </th>
                          <th className="pb-2 pr-4 font-medium text-muted-foreground text-xs text-right">
                            Files
                          </th>
                          <th className="pb-2 pr-4 font-medium text-muted-foreground text-xs text-right">
                            Lists
                          </th>
                          <th className="pb-2 pr-4 font-medium text-muted-foreground text-xs text-right">
                            Size
                          </th>
                          <th className="pb-2 font-medium text-muted-foreground text-xs text-right">
                            When
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
                            <td className="py-2.5 pr-4">
                              <Link
                                to={`/snapshots/${snap.id}`}
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
                            </td>
                            <td className="py-2.5 pr-4 text-muted-foreground">
                              {snap.platform}/{snap.arch}
                            </td>
                            <td className="py-2.5 pr-4 text-right tabular-nums">
                              {snap.fileCount}
                            </td>
                            <td className="py-2.5 pr-4 text-right tabular-nums">
                              {snap.listCount}
                            </td>
                            <td className="py-2.5 pr-4 text-right tabular-nums text-muted-foreground">
                              {formatSize(snap.sizeBytes)}
                            </td>
                            <td className="py-2.5 text-right">
                              <div className="flex items-center justify-end gap-2">
                                <span className="text-muted-foreground text-xs">
                                  {formatTimeAgo(snap.snapshotAt)}
                                </span>
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
                )}
              </div>

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
