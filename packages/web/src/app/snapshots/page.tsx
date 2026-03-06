"use client";

import Link from "next/link";
import {
  Archive,
  Monitor,
  Search,
  ChevronLeft,
  ChevronRight,
} from "lucide-react";
import { AppShell } from "@/components/layout/app-shell";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";

// ---------------------------------------------------------------------------
// Static placeholder data (Phase 1 — will be replaced by API calls)
// ---------------------------------------------------------------------------

interface SnapshotRow {
  id: string;
  hostname: string;
  platform: string;
  arch: string;
  username: string;
  collectors: number;
  files: number;
  lists: number;
  sizeKb: number;
  createdAt: string;
  timeAgo: string;
}

const snapshots: SnapshotRow[] = [
  { id: "a1b2c3d4", hostname: "nocoo-mbp", platform: "darwin", arch: "arm64", username: "nocoo", collectors: 5, files: 21, lists: 201, sizeKb: 71, createdAt: "2026-03-06 11:30", timeAgo: "2 hours ago" },
  { id: "e5f6g7h8", hostname: "nocoo-mbp", platform: "darwin", arch: "arm64", username: "nocoo", collectors: 5, files: 21, lists: 198, sizeKb: 70, createdAt: "2026-03-05 09:15", timeAgo: "1 day ago" },
  { id: "i9j0k1l2", hostname: "nocoo-mbp", platform: "darwin", arch: "arm64", username: "nocoo", collectors: 5, files: 20, lists: 195, sizeKb: 68, createdAt: "2026-03-03 14:22", timeAgo: "3 days ago" },
  { id: "m3n4o5p6", hostname: "nocoo-mbp", platform: "darwin", arch: "arm64", username: "nocoo", collectors: 5, files: 20, lists: 190, sizeKb: 67, createdAt: "2026-03-01 08:45", timeAgo: "5 days ago" },
  { id: "q7r8s9t0", hostname: "nocoo-mbp", platform: "darwin", arch: "arm64", username: "nocoo", collectors: 4, files: 18, lists: 185, sizeKb: 62, createdAt: "2026-02-27 16:30", timeAgo: "1 week ago" },
  { id: "u1v2w3x4", hostname: "nocoo-mbp", platform: "darwin", arch: "arm64", username: "nocoo", collectors: 4, files: 18, lists: 182, sizeKb: 60, createdAt: "2026-02-24 10:00", timeAgo: "10 days ago" },
  { id: "y5z6a7b8", hostname: "nocoo-mbp", platform: "darwin", arch: "arm64", username: "nocoo", collectors: 4, files: 17, lists: 178, sizeKb: 58, createdAt: "2026-02-20 13:15", timeAgo: "2 weeks ago" },
  { id: "c9d0e1f2", hostname: "nocoo-mbp", platform: "darwin", arch: "arm64", username: "nocoo", collectors: 4, files: 17, lists: 175, sizeKb: 56, createdAt: "2026-02-15 09:30", timeAgo: "19 days ago" },
  { id: "g3h4i5j6", hostname: "nocoo-mbp", platform: "darwin", arch: "arm64", username: "nocoo", collectors: 3, files: 15, lists: 170, sizeKb: 52, createdAt: "2026-02-10 11:45", timeAgo: "24 days ago" },
  { id: "k7l8m9n0", hostname: "nocoo-mbp", platform: "darwin", arch: "arm64", username: "nocoo", collectors: 3, files: 14, lists: 165, sizeKb: 48, createdAt: "2026-02-05 15:00", timeAgo: "29 days ago" },
  { id: "o1p2q3r4", hostname: "nocoo-mbp", platform: "darwin", arch: "arm64", username: "nocoo", collectors: 3, files: 14, lists: 160, sizeKb: 45, createdAt: "2026-02-01 08:00", timeAgo: "1 month ago" },
  { id: "s5t6u7v8", hostname: "nocoo-mbp", platform: "darwin", arch: "arm64", username: "nocoo", collectors: 3, files: 12, lists: 150, sizeKb: 40, createdAt: "2026-01-25 12:30", timeAgo: "1 month ago" },
];

// ---------------------------------------------------------------------------
// Components
// ---------------------------------------------------------------------------

export default function SnapshotsPage() {
  return (
    <AppShell breadcrumbs={[{ label: "Snapshots" }]}>
      <div className="space-y-6">
        {/* Header */}
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">Snapshots</h1>
            <p className="text-sm text-muted-foreground">
              Browse all dev environment backups
            </p>
          </div>
          <div className="relative w-full sm:w-64">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" strokeWidth={1.5} />
            <Input
              placeholder="Search by hostname..."
              className="pl-9"
              disabled
            />
          </div>
        </div>

        {/* Table */}
        <div className="rounded-xl bg-secondary p-1">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border">
                  <th className="px-4 py-3 text-left font-medium text-muted-foreground text-xs">Snapshot</th>
                  <th className="px-4 py-3 text-left font-medium text-muted-foreground text-xs">Host</th>
                  <th className="px-4 py-3 text-left font-medium text-muted-foreground text-xs">Platform</th>
                  <th className="px-4 py-3 text-right font-medium text-muted-foreground text-xs">Collectors</th>
                  <th className="px-4 py-3 text-right font-medium text-muted-foreground text-xs">Files</th>
                  <th className="px-4 py-3 text-right font-medium text-muted-foreground text-xs">Lists</th>
                  <th className="px-4 py-3 text-right font-medium text-muted-foreground text-xs">Size</th>
                  <th className="px-4 py-3 text-right font-medium text-muted-foreground text-xs">Created</th>
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
                        <Archive className="h-3.5 w-3.5 text-muted-foreground" strokeWidth={1.5} />
                        <code className="text-xs font-mono">{snap.id}</code>
                      </Link>
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2">
                        <Monitor className="h-3.5 w-3.5 text-muted-foreground" strokeWidth={1.5} />
                        <span className="font-medium">{snap.hostname}</span>
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      <Badge variant="secondary" className="text-xs font-normal">
                        {snap.platform}/{snap.arch}
                      </Badge>
                    </td>
                    <td className="px-4 py-3 text-right tabular-nums">{snap.collectors}</td>
                    <td className="px-4 py-3 text-right tabular-nums">{snap.files}</td>
                    <td className="px-4 py-3 text-right tabular-nums">{snap.lists}</td>
                    <td className="px-4 py-3 text-right tabular-nums text-muted-foreground">{snap.sizeKb} KB</td>
                    <td className="px-4 py-3 text-right">
                      <div className="flex flex-col items-end">
                        <span className="text-xs text-muted-foreground">{snap.timeAgo}</span>
                        <span className="text-[10px] text-muted-foreground/60">{snap.createdAt}</span>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        {/* Pagination (static placeholder) */}
        <div className="flex items-center justify-between px-2">
          <p className="text-xs text-muted-foreground">
            Showing 1-12 of 12 snapshots
          </p>
          <div className="flex items-center gap-1">
            <button
              disabled
              className="flex h-8 w-8 items-center justify-center rounded-lg text-muted-foreground disabled:opacity-40"
            >
              <ChevronLeft className="h-4 w-4" />
            </button>
            <span className="px-2 text-xs text-muted-foreground">Page 1 of 1</span>
            <button
              disabled
              className="flex h-8 w-8 items-center justify-center rounded-lg text-muted-foreground disabled:opacity-40"
            >
              <ChevronRight className="h-4 w-4" />
            </button>
          </div>
        </div>
      </div>
    </AppShell>
  );
}
