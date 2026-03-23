"use client";

import { Globe, Loader2, Settings } from "lucide-react";
import { use, useEffect, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { CollectorsTab } from "./_components/collectors-tab";
import { ExportSection } from "./_components/export-section";
import { formatDateTime } from "./_components/helpers";
import { OverviewTab } from "./_components/overview-tab";
import type { SnapshotData, SnapshotMeta } from "./_components/types";

export default function SnapshotDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const [meta, setMeta] = useState<SnapshotMeta | null>(null);
  const [data, setData] = useState<SnapshotData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function fetchSnapshot() {
      try {
        const res = await fetch(`/api/snapshots/${id}`);
        if (!res.ok) {
          const body = await res.json().catch(() => null);
          if (res.status === 404) {
            setError(body?.error ?? "Snapshot not found");
            return;
          }
          throw new Error(body?.error ?? `Failed to load snapshot (${res.status})`);
        }
        const result = await res.json();
        setMeta(result.snapshot);
        setData(result.data);
        setError(null);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Unknown error");
      } finally {
        setLoading(false);
      }
    }
    void fetchSnapshot();
  }, [id]);

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center py-20">
        <Loader2 className="h-8 w-8 text-muted-foreground/40 animate-spin" />
        <p className="mt-3 text-sm text-muted-foreground">Loading snapshot...</p>
      </div>
    );
  }

  if (error || !meta || !data) {
    return (
      <div className="flex flex-col items-center justify-center py-20">
        <p className="text-sm text-destructive">{error ?? "Snapshot not found"}</p>
      </div>
    );
  }

  const collectors = data.collectors ?? [];
  const totalFiles = collectors.reduce((sum, c) => sum + c.files.length, 0);
  const totalLists = collectors.reduce((sum, c) => sum + c.lists.length, 0);
  const configCount = collectors.filter((c) => c.category === "config").length;
  const envCount = collectors.filter((c) => c.category === "environment").length;

  return (
    <div className="space-y-6">
      {/* Header */}
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

      {/* Tabs */}
      <Tabs defaultValue="overview">
        <TabsList>
          <TabsTrigger value="overview">Overview</TabsTrigger>
          <TabsTrigger value="config" className="gap-1.5">
            <Settings className="h-3.5 w-3.5" strokeWidth={1.5} />
            Config
            <Badge variant="secondary" className="text-[10px] font-normal ml-0.5 px-1.5 py-0">
              {configCount}
            </Badge>
          </TabsTrigger>
          <TabsTrigger value="environment" className="gap-1.5">
            <Globe className="h-3.5 w-3.5" strokeWidth={1.5} />
            Environment
            <Badge variant="secondary" className="text-[10px] font-normal ml-0.5 px-1.5 py-0">
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

      {/* Export */}
      <ExportSection data={data} snapshotId={id} />
    </div>
  );
}
