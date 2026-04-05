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
// Stat card used in the machine info grid
// ---------------------------------------------------------------------------

function StatCard({
  icon: Icon,
  label,
  value,
}: {
  icon: React.ComponentType<{ className?: string; strokeWidth?: number }>;
  label: string;
  value: string;
}) {
  return (
    <Card className="gap-0 py-0">
      <CardContent className="px-4 py-3.5 flex items-center gap-3">
        <Icon className="h-4 w-4 text-primary shrink-0" strokeWidth={1.5} />
        <div className="min-w-0">
          <p className="text-2xs text-muted-foreground uppercase tracking-wider">{label}</p>
          <p className="text-sm font-medium truncate">{value}</p>
        </div>
      </CardContent>
    </Card>
  );
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
      <CardHeader className="gap-0 px-5 py-4 border-b border-border/40">
        <CardTitle className="text-sm">Collectors</CardTitle>
        <CardDescription>{collectors.length} collectors captured in this snapshot</CardDescription>
      </CardHeader>
      <CardContent className="px-5 py-4">
        <div className="grid gap-6 sm:grid-cols-2">
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
      <CardHeader className="gap-0 px-5 py-4 border-b border-border/40">
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
      <CardHeader className="gap-0 px-5 py-4 border-b border-border/40">
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
              <AlertTriangle className="h-3 w-3" strokeWidth={1.5} />
              Errors
            </h4>
            {errors.map((err) => (
              <div
                key={`${err.collector}-${err.message}`}
                className="rounded-lg bg-destructive/5 border border-destructive/10 px-3 py-2"
              >
                <p className="text-xs font-medium text-foreground">{err.collector}</p>
                <p className="text-xs text-destructive/80 mt-0.5">{err.message}</p>
              </div>
            ))}
          </div>
        )}
        {skipped.length > 0 && (
          <div className="space-y-2">
            <h4 className="text-xs font-medium text-muted-foreground uppercase tracking-wider flex items-center gap-1.5">
              <SkipForward className="h-3 w-3" strokeWidth={1.5} />
              Skipped
            </h4>
            {skipped.map((item, i) => (
              // biome-ignore lint/suspicious/noArrayIndexKey: static display list, no reordering
              <div key={i} className="rounded-lg bg-card px-3 py-2">
                <p className="text-xs font-medium text-foreground">{item.collector}</p>
                <p className="text-xs text-muted-foreground mt-0.5">{item.message}</p>
              </div>
            ))}
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
    <div className="space-y-6">
      {/* Machine info grid */}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
        <StatCard icon={Monitor} label="Host" value={meta.hostname} />
        <StatCard icon={Cpu} label="Platform" value={`${meta.platform}/${meta.arch}`} />
        <StatCard icon={User} label="User" value={meta.username} />
        <StatCard
          icon={Archive}
          label="Content"
          value={`${totalFiles} files, ${totalLists} items`}
        />
        <StatCard icon={HardDrive} label="Size" value={formatSize(meta.sizeBytes)} />
      </div>

      {/* Charts row */}
      <div className="grid gap-6 lg:grid-cols-2">
        {/* Collector summary with donut chart */}
        <CollectorSummaryCard collectors={collectors} />

        {/* Top collectors bar chart */}
        <TopCollectorsCard collectors={collectors} />
      </div>

      {/* Errors & skipped */}
      <IssuesCard collectors={collectors} />
    </div>
  );
}
