"use client";

import {
  AlertTriangle,
  Archive,
  Cpu,
  FileText,
  HardDrive,
  List,
  Monitor,
  SkipForward,
  User,
} from "lucide-react";
import { BarChart, DonutChart } from "@/components/charts";
import { DashboardSegment } from "@/components/dashboard/dashboard-segment";
import { StatCard, StatGrid } from "@/components/dashboard/stat-card";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { formatSize } from "@/lib/utils";
import type { Collector, SnapshotMeta } from "./types";

interface OverviewTabProps {
  meta: SnapshotMeta;
  collectors: Collector[];
  totalFiles: number;
  totalLists: number;
}

// ---------------------------------------------------------------------------
// Summary card showing collector category breakdown
// ---------------------------------------------------------------------------

function CollectorSummaryCard({ collectors }: { collectors: Collector[] }) {
  const configCollectors = collectors.filter((c) => c.category === "config");
  const envCollectors = collectors.filter((c) => c.category === "environment");

  const configFiles = configCollectors.reduce((s, c) => s + c.files.length, 0);
  const configItems = configCollectors.reduce((s, c) => s + c.lists.length, 0);
  const envFiles = envCollectors.reduce((s, c) => s + c.files.length, 0);
  const envItems = envCollectors.reduce((s, c) => s + c.lists.length, 0);

  const rows = [
    {
      label: "Config",
      count: configCollectors.length,
      files: configFiles,
      items: configItems,
    },
    {
      label: "Environment",
      count: envCollectors.length,
      files: envFiles,
      items: envItems,
    },
  ];

  // Data for donut chart
  const donutData = [
    { name: "Config", value: configCollectors.length },
    { name: "Environment", value: envCollectors.length },
  ].filter((d) => d.value > 0);

  return (
    <Card className="gap-0 py-0">
      <CardHeader className="gap-0 px-5 py-3.5 border-b border-border/40">
        <CardTitle className="text-sm">Collectors</CardTitle>
        <CardDescription>{collectors.length} collectors captured in this snapshot</CardDescription>
      </CardHeader>
      <CardContent className="px-5 py-4">
        <div className="grid gap-4 sm:grid-cols-2">
          {/* Donut Chart */}
          <div className="flex items-center justify-center">
            <DonutChart data={donutData} height={140} showLegend={false} />
          </div>
          {/* Stats */}
          <div className="space-y-3">
            {rows.map((row) => (
              <div key={row.label} className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-medium">{row.label}</span>
                  <Badge variant="secondary" className="text-2xs font-normal">
                    {row.count}
                  </Badge>
                </div>
                <div className="flex items-center gap-3 text-xs text-muted-foreground">
                  <span className="flex items-center gap-1">
                    <FileText className="h-3 w-3" strokeWidth={1.5} />
                    {row.files} file{row.files !== 1 ? "s" : ""}
                  </span>
                  <span className="flex items-center gap-1">
                    <List className="h-3 w-3" strokeWidth={1.5} />
                    {row.items} item{row.items !== 1 ? "s" : ""}
                  </span>
                </div>
              </div>
            ))}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Top collectors by file count
// ---------------------------------------------------------------------------

function TopCollectorsCard({ collectors }: { collectors: Collector[] }) {
  // Get top 5 collectors by file count
  const topCollectors = [...collectors]
    .map((c) => ({
      name: c.label,
      value: c.files.length,
    }))
    .filter((c) => c.value > 0)
    .sort((a, b) => b.value - a.value)
    .slice(0, 5);

  if (topCollectors.length === 0) return null;

  return (
    <Card className="gap-0 py-0">
      <CardHeader className="gap-0 px-5 py-3.5 border-b border-border/40">
        <CardTitle className="text-sm">Top Collectors</CardTitle>
        <CardDescription>By number of files captured</CardDescription>
      </CardHeader>
      <CardContent className="px-5 py-4">
        <BarChart data={topCollectors} height={160} layout="horizontal" />
      </CardContent>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Errors & skipped card
// ---------------------------------------------------------------------------

function IssuesCard({ collectors }: { collectors: Collector[] }) {
  const errors = collectors.flatMap((c) =>
    c.errors.map((err) => ({ collector: c.label, message: err })),
  );
  const skipped = collectors.flatMap((c) =>
    (c.skipped ?? []).map((msg) => ({ collector: c.label, message: msg })),
  );

  if (errors.length === 0 && skipped.length === 0) return null;

  return (
    <Card className="gap-0 py-0">
      <CardHeader className="gap-0 px-5 py-3.5 border-b border-border/40">
        <CardTitle className="text-sm">Issues</CardTitle>
        <CardDescription>
          {errors.length} error{errors.length !== 1 ? "s" : ""}
          {skipped.length > 0 && `, ${skipped.length} skipped`}
        </CardDescription>
      </CardHeader>
      <CardContent className="px-5 py-4 space-y-4">
        {errors.length > 0 && (
          <div className="space-y-2">
            <h4 className="text-xs font-medium text-destructive uppercase tracking-wider flex items-center gap-1.5">
              <AlertTriangle className="h-3 w-3" strokeWidth={1.5} aria-hidden="true" />
              Errors
            </h4>
            <ul className="space-y-1.5">
              {errors.map((err) => (
                <li
                  key={`${err.collector}-${err.message}`}
                  className="border-l-2 border-destructive/40 pl-3 py-1"
                >
                  <p className="text-xs font-medium text-foreground">{err.collector}</p>
                  <p className="text-xs text-destructive/80 mt-0.5">{err.message}</p>
                </li>
              ))}
            </ul>
          </div>
        )}
        {skipped.length > 0 && (
          <div className="space-y-2">
            <h4 className="text-xs font-medium text-muted-foreground uppercase tracking-wider flex items-center gap-1.5">
              <SkipForward className="h-3 w-3" strokeWidth={1.5} aria-hidden="true" />
              Skipped
            </h4>
            <ul className="space-y-1.5">
              {skipped.map((item, i) => (
                // biome-ignore lint/suspicious/noArrayIndexKey: static display list, no reordering
                <li key={i} className="border-l-2 border-border pl-3 py-1">
                  <p className="text-xs font-medium text-foreground">{item.collector}</p>
                  <p className="text-xs text-muted-foreground mt-0.5">{item.message}</p>
                </li>
              ))}
            </ul>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Overview Tab
// ---------------------------------------------------------------------------

export function OverviewTab({ meta, collectors, totalFiles, totalLists }: OverviewTabProps) {
  return (
    <div className="space-y-4 md:space-y-6">
      {/* ── Machine Info ──────────────────────────────────── */}
      <DashboardSegment title="Machine Info">
        <StatGrid columns={5}>
          <StatCard
            title="Host"
            value={meta.hostname}
            icon={Monitor}
            iconColor="text-primary"
            accentColor="bg-primary"
          />
          <StatCard
            title="Platform"
            value={`${meta.platform}/${meta.arch}`}
            icon={Cpu}
            accentColor="bg-chart-3"
          />
          <StatCard title="User" value={meta.username} icon={User} accentColor="bg-chart-5" />
          <StatCard
            title="Content"
            value={`${totalFiles} files, ${totalLists} items`}
            icon={Archive}
            accentColor="bg-chart-6"
          />
          <StatCard
            title="Size"
            value={formatSize(meta.sizeBytes)}
            icon={HardDrive}
            accentColor="bg-chart-7"
          />
        </StatGrid>
      </DashboardSegment>

      {/* ── Charts ────────────────────────────────────────── */}
      <DashboardSegment title="Breakdown">
        <div className="grid gap-4 lg:grid-cols-2">
          {/* Collector summary with donut chart */}
          <CollectorSummaryCard collectors={collectors} />

          {/* Top collectors bar chart */}
          <TopCollectorsCard collectors={collectors} />
        </div>
      </DashboardSegment>

      {/* ── Errors & skipped ──────────────────────────────── */}
      <IssuesCard collectors={collectors} />
    </div>
  );
}
