import { LayerCard } from "@nocoo/basalt";
import { BarChart } from "@nocoo/basalt/charts/bar";
import { DonutChart } from "@nocoo/basalt/charts/donut";
import { SectionRule } from "@nocoo/basalt/components/section-rule";
import { Archive, Cpu, HardDrive, Monitor, User } from "lucide-react";
import { formatSize } from "@/lib/utils";
import type { Collector, SnapshotMeta } from "./types";

interface OverviewTabProps {
  meta: SnapshotMeta;
  collectors: Collector[];
  totalFiles: number;
  totalLists: number;
}

function CategoryBreakdownChart({ collectors }: { collectors: Collector[] }) {
  const chartData = [
    { name: "Config", category: "config" },
    { name: "Environment", category: "environment" },
  ]
    .map(({ name, category }) => {
      const matches = collectors.filter((collector) => collector.category === category);
      return {
        name,
        value: matches.length,
        files: matches.reduce((total, collector) => total + collector.files.length, 0),
        items: matches.reduce((total, collector) => total + collector.lists.length, 0),
      };
    })
    .filter((category) => category.value > 0);
  const total = chartData.reduce((count, category) => count + category.value, 0);

  return (
    <LayerCard>
      <LayerCard.Header>By Category</LayerCard.Header>
      <LayerCard.Body>
        <DonutChart
          data={chartData}
          ariaLabel="Collectors by category"
          className="mx-auto"
          showLegend
          valueFormatter={(value) => value + (value !== 1 ? " collectors" : " collector")}
          dataAlternative={
            <LayerCard.Well className="space-y-2 rounded-basalt-lg p-3">
              {chartData.map((category) => (
                <div
                  key={category.name}
                  className="flex flex-wrap items-center justify-between gap-2"
                >
                  <span className="font-medium text-basalt-foreground">{category.name}</span>
                  <span className="tabular-nums">
                    {category.value} collector{category.value !== 1 ? "s" : ""} · {category.files}{" "}
                    files · {category.items} items
                  </span>
                </div>
              ))}
              <p className="font-medium text-basalt-foreground">Total: {total} collectors</p>
            </LayerCard.Well>
          }
        />
      </LayerCard.Body>
    </LayerCard>
  );
}

function TopCollectorsChart({ collectors }: { collectors: Collector[] }) {
  const topCollectors = collectors
    .map((collector) => ({ x: collector.label, y: collector.files.length }))
    .filter((collector) => collector.y > 0)
    .sort((first, second) => second.y - first.y)
    .slice(0, 5);

  return (
    <LayerCard>
      <LayerCard.Header>Top Collectors</LayerCard.Header>
      {topCollectors.length === 0 ? (
        <LayerCard.Empty title="No files captured" />
      ) : (
        <LayerCard.Body>
          <BarChart
            data={topCollectors}
            series={[{ key: "y", label: "Files" }]}
            ariaLabel="Top five collectors by file count"
            className="h-40 w-full"
            valueFormatter={(value) => value + (value !== 1 ? " files" : " file")}
            dataAlternative={
              <LayerCard.Well className="space-y-2 rounded-basalt-lg p-3">
                {topCollectors.map((collector) => (
                  <div key={collector.x} className="flex items-center justify-between gap-3">
                    <span className="font-medium text-basalt-foreground">{collector.x}</span>
                    <span className="tabular-nums">
                      {collector.y} file{collector.y !== 1 ? "s" : ""}
                    </span>
                  </div>
                ))}
              </LayerCard.Well>
            }
          />
        </LayerCard.Body>
      )}
    </LayerCard>
  );
}

function IssuesSection({ collectors }: { collectors: Collector[] }) {
  const errors = collectors.flatMap((collector) =>
    collector.errors.map((message) => ({ collector: collector.label, message })),
  );
  const skipped = collectors.flatMap((collector) =>
    (collector.skipped ?? []).map((message) => ({ collector: collector.label, message })),
  );

  if (errors.length === 0 && skipped.length === 0) return null;

  return (
    <SectionRule title="Issues">
      <div className="grid gap-4 lg:grid-cols-2">
        {errors.length > 0 && (
          <LayerCard>
            <LayerCard.Header className="text-basalt-destructive">
              {errors.length} Error{errors.length !== 1 ? "s" : ""}
            </LayerCard.Header>
            <LayerCard.Body>
              <ul className="space-y-2">
                {errors.map((error, index) => (
                  <li key={[error.collector, error.message, index].join(":")}>
                    <LayerCard.Well className="rounded-basalt-lg p-3 text-xs">
                      <p className="font-medium">{error.collector}</p>
                      <p className="mt-1 text-basalt-destructive">{error.message}</p>
                    </LayerCard.Well>
                  </li>
                ))}
              </ul>
            </LayerCard.Body>
          </LayerCard>
        )}
        {skipped.length > 0 && (
          <LayerCard>
            <LayerCard.Header>{skipped.length} Skipped</LayerCard.Header>
            <LayerCard.Body>
              <ul className="space-y-2">
                {skipped.map((item, index) => (
                  <li key={[item.collector, item.message, index].join(":")}>
                    <LayerCard.Well className="rounded-basalt-lg p-3 text-xs">
                      <p className="font-medium">{item.collector}</p>
                      <p className="mt-1 text-basalt-muted-foreground">{item.message}</p>
                    </LayerCard.Well>
                  </li>
                ))}
              </ul>
            </LayerCard.Body>
          </LayerCard>
        )}
      </div>
    </SectionRule>
  );
}

export function OverviewTab({ meta, collectors, totalFiles, totalLists }: OverviewTabProps) {
  return (
    <div className="space-y-4">
      <SectionRule title="Machine Info">
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-5">
          {[
            { title: "Host", value: meta.hostname, icon: Monitor },
            { title: "Platform", value: `${meta.platform}/${meta.arch}`, icon: Cpu },
            { title: "User", value: meta.username, icon: User },
            { title: "Content", value: `${totalFiles} files, ${totalLists} items`, icon: Archive },
            { title: "Size", value: formatSize(meta.sizeBytes), icon: HardDrive },
          ].map((metric) => (
            <LayerCard key={metric.title}>
              <div className="flex items-center gap-2 text-xs text-basalt-muted-foreground">
                <metric.icon className="h-4 w-4" strokeWidth={1.5} aria-hidden="true" />
                {metric.title}
              </div>
              <p className="mt-2 break-words text-lg font-semibold tabular-nums">{metric.value}</p>
            </LayerCard>
          ))}
        </div>
      </SectionRule>
      <SectionRule title="Breakdown">
        <div className="grid gap-4 lg:grid-cols-2">
          <CategoryBreakdownChart collectors={collectors} />
          <TopCollectorsChart collectors={collectors} />
        </div>
      </SectionRule>
      <IssuesSection collectors={collectors} />
    </div>
  );
}
