"use client";

import Link from "next/link";
import {
  Archive,
  FileText,
  List,
  Clock,
  Monitor,
  ArrowRight,
  type LucideIcon,
} from "lucide-react";
import { AppShell } from "@/components/layout/app-shell";

// ---------------------------------------------------------------------------
// Static placeholder data (Phase 1 — will be replaced by API calls)
// ---------------------------------------------------------------------------

interface StatCard {
  label: string;
  value: string;
  icon: LucideIcon;
}

const stats: StatCard[] = [
  { label: "Total Snapshots", value: "12", icon: Archive },
  { label: "Config Files", value: "21", icon: FileText },
  { label: "List Items", value: "201", icon: List },
  { label: "Last Backup", value: "2 hours ago", icon: Clock },
];

interface RecentSnapshot {
  id: string;
  hostname: string;
  platform: string;
  collectors: number;
  files: number;
  lists: number;
  sizeKb: number;
  timeAgo: string;
}

const recentSnapshots: RecentSnapshot[] = [
  { id: "snap-001", hostname: "nocoo-mbp", platform: "darwin/arm64", collectors: 5, files: 21, lists: 201, sizeKb: 71, timeAgo: "2 hours ago" },
  { id: "snap-002", hostname: "nocoo-mbp", platform: "darwin/arm64", collectors: 5, files: 21, lists: 198, sizeKb: 70, timeAgo: "1 day ago" },
  { id: "snap-003", hostname: "nocoo-mbp", platform: "darwin/arm64", collectors: 5, files: 20, lists: 195, sizeKb: 68, timeAgo: "3 days ago" },
  { id: "snap-004", hostname: "nocoo-mbp", platform: "darwin/arm64", collectors: 5, files: 20, lists: 190, sizeKb: 67, timeAgo: "5 days ago" },
  { id: "snap-005", hostname: "nocoo-mbp", platform: "darwin/arm64", collectors: 4, files: 18, lists: 185, sizeKb: 62, timeAgo: "1 week ago" },
];

interface Activity {
  message: string;
  timeAgo: string;
}

const recentActivity: Activity[] = [
  { message: "Snapshot received from nocoo-mbp via webhook", timeAgo: "2 hours ago" },
  { message: "New webhook token created: dev-macbook", timeAgo: "1 day ago" },
  { message: "Snapshot received from nocoo-mbp via webhook", timeAgo: "1 day ago" },
  { message: "Snapshot received from nocoo-mbp via webhook", timeAgo: "3 days ago" },
  { message: "Webhook token dev-macbook activated", timeAgo: "1 week ago" },
];

// ---------------------------------------------------------------------------
// Components
// ---------------------------------------------------------------------------

function StatCardComponent({ label, value, icon: Icon }: StatCard) {
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
  return (
    <AppShell>
      <div className="space-y-8">
        {/* Header */}
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Dashboard</h1>
          <p className="text-sm text-muted-foreground">
            Overview of your dev environment backups
          </p>
        </div>

        {/* Stats Cards */}
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {stats.map((stat) => (
            <StatCardComponent key={stat.label} {...stat} />
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
                  {recentSnapshots.map((snap) => (
                    <tr key={snap.id} className="border-b border-border/50 last:border-0">
                      <td className="py-2.5 pr-4">
                        <div className="flex items-center gap-2">
                          <Monitor className="h-3.5 w-3.5 text-muted-foreground" strokeWidth={1.5} />
                          <span className="font-medium">{snap.hostname}</span>
                        </div>
                      </td>
                      <td className="py-2.5 pr-4 text-muted-foreground">{snap.platform}</td>
                      <td className="py-2.5 pr-4 text-right tabular-nums">{snap.files}</td>
                      <td className="py-2.5 pr-4 text-right tabular-nums">{snap.lists}</td>
                      <td className="py-2.5 pr-4 text-right tabular-nums text-muted-foreground">{snap.sizeKb} KB</td>
                      <td className="py-2.5 text-right text-muted-foreground text-xs">{snap.timeAgo}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {/* Activity Feed (1/3 width) */}
          <div className="rounded-xl bg-secondary p-5">
            <h2 className="text-sm font-medium text-foreground mb-4">Activity</h2>
            <div className="space-y-3">
              {recentActivity.map((item, i) => (
                <div key={i} className="flex gap-3">
                  <div className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-primary/60" />
                  <div className="min-w-0">
                    <p className="text-sm text-foreground leading-snug">{item.message}</p>
                    <p className="text-xs text-muted-foreground mt-0.5">{item.timeAgo}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </AppShell>
  );
}
