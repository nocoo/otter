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
import { Cell, Pie, PieChart, ResponsiveContainer } from "recharts";
import { DashboardSegment } from "@/components/dashboard/dashboard-segment";
import { StatCard, StatGrid } from "@/components/dashboard/stat-card";
import { CHART_COLORS } from "@/lib/palette";
import { formatSize } from "@/lib/utils";
import type { Collector, SnapshotMeta } from "./types";

interface OverviewTabProps {
  meta: SnapshotMeta;
  collectors: Collector[];
  totalFiles: number;
  totalLists: number;
}

// ---------------------------------------------------------------------------
// Category breakdown chart (donut + legend)
// ---------------------------------------------------------------------------

function CategoryBreakdownChart({ collectors }: { collectors: Collector[] }) {
  const configCollectors = collectors.filter((c) => c.category === "config");
  const envCollectors = collectors.filter((c) => c.category === "environment");

  const configFiles = configCollectors.reduce((s, c) => s + c.files.length, 0);
  const configItems = configCollectors.reduce((s, c) => s + c.lists.length, 0);
  const envFiles = envCollectors.reduce((s, c) => s + c.files.length, 0);
  const envItems = envCollectors.reduce((s, c) => s + c.lists.length, 0);

  const chartData = [
    {
      name: "Config",
      value: configCollectors.length,
      files: configFiles,
      items: configItems,
      fill: CHART_COLORS[0] ?? "hsl(var(--primary))",
    },
    {
      name: "Environment",
      value: envCollectors.length,
      files: envFiles,
      items: envItems,
      fill: CHART_COLORS[1] ?? "hsl(var(--chart-2))",
    },
  ].filter((d) => d.value > 0);

  const total = chartData.reduce((sum, d) => sum + d.value, 0);

  return (
    <div className="rounded-[var(--radius-card)] bg-secondary p-4 md:p-5">
      <p className="mb-3 text-xs md:text-sm text-muted-foreground">By Category</p>

      <div className="flex flex-col items-center">
        {/* Donut chart */}
        <div className="w-full max-w-[180px] h-[140px]">
          <ResponsiveContainer width="100%" height="100%">
            <PieChart>
              <Pie
                data={chartData}
                cx="50%"
                cy="50%"
                innerRadius="50%"
                outerRadius="80%"
                dataKey="value"
                strokeWidth={0}
                paddingAngle={2}
              >
                {chartData.map((entry) => (
                  <Cell key={entry.name} fill={entry.fill} />
                ))}
              </Pie>
            </PieChart>
          </ResponsiveContainer>
        </div>

        {/* Legend with stats */}
        <div className="mt-3 w-full space-y-2">
          {chartData.map((item) => (
            <div key={item.name} className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <div
                  className="h-2.5 w-2.5 rounded-full shrink-0"
                  style={{ background: item.fill }}
                />
                <span className="text-sm font-medium">{item.name}</span>
                <span className="text-xs text-muted-foreground">
                  {item.value} collector{item.value !== 1 ? "s" : ""}
                </span>
              </div>
              <div className="flex items-center gap-3 text-xs text-muted-foreground">
                <span className="flex items-center gap-1">
                  <FileText className="h-3 w-3" strokeWidth={1.5} />
                  {item.files}
                </span>
                <span className="flex items-center gap-1">
                  <List className="h-3 w-3" strokeWidth={1.5} />
                  {item.items}
                </span>
              </div>
            </div>
          ))}
        </div>

        {/* Total */}
        <div className="mt-3 pt-3 border-t border-border/40 w-full flex items-center justify-between">
          <span className="text-xs text-muted-foreground">Total</span>
          <span className="text-sm font-medium">{total} collectors</span>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Top collectors horizontal bar chart
// ---------------------------------------------------------------------------

function TopCollectorsChart({ collectors }: { collectors: Collector[] }) {
  // Get top 5 collectors by file count
  const topCollectors = [...collectors]
    .map((c, idx) => ({
      name: c.label,
      value: c.files.length,
      fill: CHART_COLORS[idx % CHART_COLORS.length],
    }))
    .filter((c) => c.value > 0)
    .sort((a, b) => b.value - a.value)
    .slice(0, 5);

  if (topCollectors.length === 0) {
    return (
      <div className="rounded-[var(--radius-card)] bg-secondary p-4 md:p-5">
        <p className="mb-3 text-xs md:text-sm text-muted-foreground">Top Collectors</p>
        <p className="text-xs text-muted-foreground/60 py-8 text-center">No files captured</p>
      </div>
    );
  }

  const maxValue = Math.max(...topCollectors.map((c) => c.value));

  return (
    <div className="rounded-[var(--radius-card)] bg-secondary p-4 md:p-5">
      <p className="mb-3 text-xs md:text-sm text-muted-foreground">Top Collectors</p>

      <div className="space-y-2.5">
        {topCollectors.map((item, idx) => (
          <div key={item.name} className="space-y-1">
            <div className="flex items-center justify-between text-xs">
              <span className="text-foreground font-medium truncate max-w-[70%]">{item.name}</span>
              <span className="text-muted-foreground tabular-nums">
                {item.value} file{item.value !== 1 ? "s" : ""}
              </span>
            </div>
            <div className="h-2 rounded-full bg-card overflow-hidden">
              <div
                className="h-full rounded-full transition-all duration-300"
                style={{
                  width: `${(item.value / maxValue) * 100}%`,
                  backgroundColor: CHART_COLORS[idx % CHART_COLORS.length],
                }}
              />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Errors & skipped issues section
// ---------------------------------------------------------------------------

function IssuesSection({ collectors }: { collectors: Collector[] }) {
  const errors = collectors.flatMap((c) =>
    c.errors.map((err) => ({ collector: c.label, message: err })),
  );
  const skipped = collectors.flatMap((c) =>
    (c.skipped ?? []).map((msg) => ({ collector: c.label, message: msg })),
  );

  if (errors.length === 0 && skipped.length === 0) return null;

  return (
    <DashboardSegment title="Issues">
      <div className="rounded-[var(--radius-card)] bg-secondary p-4 md:p-5 space-y-4">
        {errors.length > 0 && (
          <div className="space-y-2">
            <h4 className="text-xs font-medium text-destructive uppercase tracking-wider flex items-center gap-1.5">
              <AlertTriangle className="h-3 w-3" strokeWidth={1.5} aria-hidden="true" />
              {errors.length} Error{errors.length !== 1 ? "s" : ""}
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
              {skipped.length} Skipped
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
      </div>
    </DashboardSegment>
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
          <CategoryBreakdownChart collectors={collectors} />
          <TopCollectorsChart collectors={collectors} />
        </div>
      </DashboardSegment>

      {/* ── Errors & skipped ──────────────────────────────── */}
      <IssuesSection collectors={collectors} />
    </div>
  );
}
