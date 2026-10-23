import { Badge, LayerCard, Tabs, TabsContent, TabsList, TabsTrigger } from "@nocoo/basalt";
import { Banner } from "@nocoo/basalt/components/banner";
import { PageHeader } from "@nocoo/basalt/components/page-header";
import { Globe, Settings } from "lucide-react";
import { useParams } from "react-router";
import { useApi } from "@/api";
import { CollectorsTab } from "@/components/snapshot/collectors-tab";
import { ExportSection } from "@/components/snapshot/export-section";
import { formatDateTime } from "@/components/snapshot/helpers";
import { OverviewTab } from "@/components/snapshot/overview-tab";
import type { SnapshotData, SnapshotMeta } from "@/components/snapshot/types";
import { RecoveryDownload, WorkspaceSnapshot } from "@/components/snapshot/workspace-snapshot";

export function SnapshotDetailPage() {
  const { id } = useParams<{ id: string }>();
  const { data, error, isLoading } = useApi<{ snapshot: SnapshotMeta; data: SnapshotData }>(
    id ? `/api/snapshots/${id}` : null,
  );
  if (isLoading) return <LayerCard.Loading label="Loading snapshot…" />;
  if (error || !data || !id)
    return (
      <LayerCard role="alert">
        <LayerCard.Empty
          title="Snapshot not found"
          description={error instanceof Error ? error.message : "Snapshot not found"}
        />
      </LayerCard>
    );
  const { snapshot: meta, data: snapshotData } = data;
  const collectors = snapshotData.collectors ?? [];
  const totalFiles = collectors.reduce((sum, c) => sum + c.files.length, 0);
  const totalLists = collectors.reduce((sum, c) => sum + c.lists.length, 0);
  const configCount = collectors.filter((c) => c.category === "config").length;
  const envCount = collectors.filter((c) => c.category === "environment").length;
  return (
    <div className="space-y-basalt-layout-lg">
      <PageHeader
        title={
          <>
            Snapshot <code className="text-lg">{id.slice(0, 8)}</code>
          </>
        }
        description={`Captured ${formatDateTime(meta.snapshotAt)}`}
      />
      {snapshotData.workspace ? (
        <WorkspaceSnapshot data={snapshotData} />
      ) : (
        <>
          <Banner
            variant="secondary"
            description="Legacy snapshot: some skills were saved as names only. Missing package contents cannot be recovered from the list."
          />
          <RecoveryDownload data={snapshotData} />
          <Tabs defaultValue="overview">
            <TabsList>
              <TabsTrigger value="overview">Overview</TabsTrigger>
              <TabsTrigger value="config">
                <Settings aria-hidden="true" strokeWidth={1.5} />
                Config <Badge variant="secondary">{configCount}</Badge>
              </TabsTrigger>
              <TabsTrigger value="environment">
                <Globe aria-hidden="true" strokeWidth={1.5} />
                Environment <Badge variant="secondary">{envCount}</Badge>
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
        </>
      )}
      <ExportSection data={snapshotData} snapshotId={id} />
    </div>
  );
}
