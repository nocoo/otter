import { Globe, Settings } from "lucide-react";
import { useParams } from "react-router";
import { useApi } from "@/api";
import { CollectorsTab } from "@/components/snapshot/collectors-tab";
import { ExportSection } from "@/components/snapshot/export-section";
import { formatDateTime } from "@/components/snapshot/helpers";
import { OverviewTab } from "@/components/snapshot/overview-tab";
import type { SnapshotData, SnapshotMeta } from "@/components/snapshot/types";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

interface SnapshotDetailResponse {
  snapshot: SnapshotMeta;
  data: SnapshotData;
}

function SnapshotDetailSkeleton() {
  return (
    <div className="space-y-6">
      <div>
        <div className="flex items-center gap-3">
          <Skeleton className="h-8 w-56" />
        </div>
        <Skeleton className="h-4 w-40 mt-2" />
      </div>

      <div className="space-y-4">
        <div className="flex gap-2">
          <Skeleton className="h-9 w-24 rounded-md" />
          <Skeleton className="h-9 w-28 rounded-md" />
          <Skeleton className="h-9 w-32 rounded-md" />
        </div>

        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
          {Array.from({ length: 4 }).map((_, i) => (
            // biome-ignore lint/suspicious/noArrayIndexKey: skeleton cards are static, never reorder
            <div key={`stat-${i}`} className="rounded-xl bg-card p-4 space-y-2">
              <Skeleton className="h-4 w-16" />
              <Skeleton className="h-8 w-12" />
            </div>
          ))}
        </div>

        <div className="space-y-3">
          {Array.from({ length: 3 }).map((_, i) => (
            // biome-ignore lint/suspicious/noArrayIndexKey: skeleton cards are static, never reorder
            <div key={`collector-${i}`} className="rounded-xl bg-card p-4 space-y-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <Skeleton className="h-8 w-8 rounded-lg" />
                  <div>
                    <Skeleton className="h-5 w-32" />
                    <Skeleton className="h-3 w-24 mt-1" />
                  </div>
                </div>
                <Skeleton className="h-5 w-16 rounded-full" />
              </div>
            </div>
          ))}
        </div>
      </div>

      <div className="rounded-xl bg-secondary p-4">
        <Skeleton className="h-4 w-32" />
      </div>
    </div>
  );
}

export function SnapshotDetailPage() {
  const { id } = useParams<{ id: string }>();
  const { data, error, isLoading } = useApi<SnapshotDetailResponse>(
    id ? `/api/snapshots/${id}` : null,
  );

  if (isLoading) {
    return <SnapshotDetailSkeleton />;
  }

  if (error || !data || !id) {
    return (
      <div className="flex flex-col items-center justify-center py-20">
        <p className="text-sm text-destructive">
          {error instanceof Error ? error.message : "Snapshot not found"}
        </p>
      </div>
    );
  }

  const { snapshot: meta, data: snapshotData } = data;
  const collectors = snapshotData.collectors ?? [];
  const totalFiles = collectors.reduce((sum, c) => sum + c.files.length, 0);
  const totalLists = collectors.reduce((sum, c) => sum + c.lists.length, 0);
  const configCount = collectors.filter((c) => c.category === "config").length;
  const envCount = collectors.filter((c) => c.category === "environment").length;

  return (
    <div className="space-y-6">
      <div>
        <div className="flex items-center gap-3">
          <h1 className="text-2xl font-semibold tracking-tight">
            Snapshot <code className="font-mono text-lg">{id.slice(0, 8)}</code>
          </h1>
        </div>
        <p className="text-sm text-muted-foreground mt-1">
          Captured {formatDateTime(meta.snapshotAt)}
        </p>
      </div>

      <Tabs defaultValue="overview">
        <TabsList>
          <TabsTrigger value="overview">Overview</TabsTrigger>
          <TabsTrigger value="config" className="gap-1.5">
            <Settings className="h-3.5 w-3.5" strokeWidth={1.5} />
            Config
            <Badge variant="secondary" className="text-2xs font-normal ml-0.5 px-1.5 py-0">
              {configCount}
            </Badge>
          </TabsTrigger>
          <TabsTrigger value="environment" className="gap-1.5">
            <Globe className="h-3.5 w-3.5" strokeWidth={1.5} />
            Environment
            <Badge variant="secondary" className="text-2xs font-normal ml-0.5 px-1.5 py-0">
              {envCount}
            </Badge>
          </TabsTrigger>
        </TabsList>

        <TabsContent value="overview">
          <OverviewTab
            meta={meta}
            collectors={collectors}
            totalFiles={totalFiles}
            totalLists={totalLists}
          />
        </TabsContent>

        <TabsContent value="config">
          <CollectorsTab collectors={collectors} category="config" />
        </TabsContent>

        <TabsContent value="environment">
          <CollectorsTab collectors={collectors} category="environment" />
        </TabsContent>
      </Tabs>

      <ExportSection data={snapshotData} snapshotId={id} />
    </div>
  );
}
