"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import {
  Archive,
  FileText,
  List,
  Clock,
  Monitor,
  ArrowRight,
  Webhook,
  Loader2,
  type LucideIcon,
} from "lucide-react";

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
  totalSnapshots: number;
  webhooks: WebhookRow[];
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

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  return `${Math.round(bytes / 1024)} KB`;
}

// ---------------------------------------------------------------------------
// Components
// ---------------------------------------------------------------------------

interface StatCardProps {
  label: string;
  value: string;
  icon: LucideIcon;
}

function StatCard({ label, value, icon: Icon }: StatCardProps) {
  return (
    <div className="rounded-xl bg-secondary p-5">
      <div className="flex items-center justify-between">
        <span className="text-sm text-muted-foreground">{label}</span>
        <Icon className="h-4 w-4 text-primary" strokeWidth={1.5} />
      </div>
      <div className="mt-2">
        <span className="text-2xl font-bold font-display">{value}</span>
      </div>
    </div>
  );
}

export default function DashboardPage() {
  const [data, setData] = useState<DashboardData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function fetchDashboard() {
      setLoading(true);
      try {
        const [snapshotsRes, webhooksRes] = await Promise.all([
          fetch("/api/snapshots?limit=5"),
          fetch("/api/webhooks"),
        ]);

        if (!snapshotsRes.ok) {
          const body = await snapshotsRes.json().catch(() => null);
          throw new Error(body?.error ?? `Failed to load snapshots (${snapshotsRes.status})`);
        }
        if (!webhooksRes.ok) {
          const body = await webhooksRes.json().catch(() => null);
          throw new Error(body?.error ?? `Failed to load webhooks (${webhooksRes.status})`);
        }

        const snapshotsData = await snapshotsRes.json();
        const webhooksData = await webhooksRes.json();

        setData({
          snapshots: snapshotsData.snapshots,
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

  const stats: StatCardProps[] = [
    {
      label: "Total Snapshots",
      value: data ? String(data.totalSnapshots) : "–",
      icon: Archive,
    },
    {
      label: "Active Webhooks",
      value: data ? String(activeWebhooks) : "–",
      icon: Webhook,
    },
    {
      label: "Config Files",
      value: latest ? String(latest.fileCount) : "–",
      icon: FileText,
    },
    {
      label: "Last Backup",
      value: latest ? formatTimeAgo(latest.snapshotAt) : "–",
      icon: Clock,
    },
  ];

  // Build activity feed from real snapshots
  const activities = (data?.snapshots ?? []).map((snap) => ({
    message: `Snapshot received from ${snap.hostname}`,
    timeAgo: formatTimeAgo(snap.uploadedAt),
  }));

  return (
    <div className="space-y-8">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Dashboard</h1>
        <p className="text-sm text-muted-foreground">
          Overview of your dev environment backups
        </p>
      </div>

      {/* Loading */}
      {loading ? (
        <div className="rounded-xl bg-secondary p-12 text-center">
          <Loader2 className="h-8 w-8 text-muted-foreground/40 mx-auto animate-spin" />
          <p className="mt-3 text-sm text-muted-foreground">Loading dashboard...</p>
        </div>
      ) : error ? (
        <div className="rounded-xl bg-secondary p-12 text-center">
          <p className="text-sm text-destructive">{error}</p>
          <button
            onClick={() => window.location.reload()}
            className="mt-2 text-xs text-muted-foreground hover:text-foreground underline"
          >
            Retry
          </button>
        </div>
      ) : (
        <>
          {/* Stats Cards */}
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {stats.map((stat) => (
              <StatCard key={stat.label} {...stat} />
            ))}
          </div>

          {/* Two-column layout: Recent Snapshots + Activity */}
          <div className="grid gap-6 lg:grid-cols-3">
            {/* Recent Snapshots (2/3 width) */}
            <div className="lg:col-span-2 rounded-xl bg-secondary p-5">
              <div className="flex items-center justify-between mb-4">
                <h2 className="text-sm font-medium text-foreground">Recent Snapshots</h2>
                <Link
                  href="/snapshots"
                  className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
                >
                  View all <ArrowRight className="h-3 w-3" />
                </Link>
              </div>
              {data && data.snapshots.length === 0 ? (
                <div className="py-8 text-center">
                  <Archive className="h-8 w-8 text-muted-foreground/40 mx-auto" strokeWidth={1.5} />
                  <p className="mt-3 text-sm text-muted-foreground">No snapshots yet</p>
                  <p className="mt-1 text-xs text-muted-foreground/60">
                    Configure a webhook and run the CLI to create your first backup
                  </p>
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-border text-left">
                        <th className="pb-2 pr-4 font-medium text-muted-foreground text-xs">Host</th>
                        <th className="pb-2 pr-4 font-medium text-muted-foreground text-xs">Platform</th>
                        <th className="pb-2 pr-4 font-medium text-muted-foreground text-xs text-right">Files</th>
                        <th className="pb-2 pr-4 font-medium text-muted-foreground text-xs text-right">Lists</th>
                        <th className="pb-2 pr-4 font-medium text-muted-foreground text-xs text-right">Size</th>
                        <th className="pb-2 font-medium text-muted-foreground text-xs text-right">When</th>
                      </tr>
                    </thead>
                    <tbody>
                      {data?.snapshots.map((snap) => (
                        <tr key={snap.id} className="border-b border-border/50 last:border-0">
                          <td className="py-2.5 pr-4">
                            <Link
                              href={`/snapshots/${snap.id}`}
                              className="flex items-center gap-2 hover:text-primary transition-colors"
                            >
                              <Monitor className="h-3.5 w-3.5 text-muted-foreground" strokeWidth={1.5} />
                              <span className="font-medium">{snap.hostname}</span>
                            </Link>
                          </td>
                          <td className="py-2.5 pr-4 text-muted-foreground">{snap.platform}/{snap.arch}</td>
                          <td className="py-2.5 pr-4 text-right tabular-nums">{snap.fileCount}</td>
                          <td className="py-2.5 pr-4 text-right tabular-nums">{snap.listCount}</td>
                          <td className="py-2.5 pr-4 text-right tabular-nums text-muted-foreground">{formatSize(snap.sizeBytes)}</td>
                          <td className="py-2.5 text-right text-muted-foreground text-xs">{formatTimeAgo(snap.snapshotAt)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>

            {/* Activity Feed (1/3 width) */}
            <div className="rounded-xl bg-secondary p-5">
              <h2 className="text-sm font-medium text-foreground mb-4">Activity</h2>
              {activities.length === 0 ? (
                <div className="py-8 text-center">
                  <List className="h-6 w-6 text-muted-foreground/40 mx-auto" strokeWidth={1.5} />
                  <p className="mt-2 text-xs text-muted-foreground">No activity yet</p>
                </div>
              ) : (
                <div className="space-y-3">
                  {activities.map((item, i) => (
                    <div key={i} className="flex gap-3">
                      <div className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-primary/60" />
                      <div className="min-w-0">
                        <p className="text-sm text-foreground leading-snug">{item.message}</p>
                        <p className="text-xs text-muted-foreground mt-0.5">{item.timeAgo}</p>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
