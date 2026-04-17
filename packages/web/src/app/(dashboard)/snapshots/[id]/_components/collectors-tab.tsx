"use client";

import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { filterCollectors, type SnapshotCollector } from "@/lib/snapshot-collectors";
import { CollectorCard } from "./collector-card";

interface CollectorsTabProps {
  collectors: SnapshotCollector[];
  category: "config" | "environment";
}

export function CollectorsTab({ collectors, category }: CollectorsTabProps) {
  const [query, setQuery] = useState("");

  // Filter by this tab's category, then apply search query
  const categoryCollectors = collectors.filter((c) => c.category === category);
  const filtered = filterCollectors(categoryCollectors, {
    query,
    category: "all", // already category-filtered above
  });

  return (
    <div className="space-y-4">
      {/* Search bar */}
      <div className="flex items-center gap-3">
        <Input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search collectors, files, items, or metadata..."
          className="bg-background"
        />
        <Badge variant="secondary" className="text-2xs font-normal shrink-0">
          {filtered.length}/{categoryCollectors.length}
        </Badge>
      </div>

      {/* Collector cards */}
      {filtered.length === 0 ? (
        <div className="rounded-xl border border-dashed border-border bg-card px-5 py-8 text-center">
          <p className="text-sm text-muted-foreground">No collectors match the current search.</p>
        </div>
      ) : (
        <div className="space-y-3">
          {filtered
            .sort((a, b) => a.label.localeCompare(b.label))
            .map((collector) => (
              <CollectorCard key={collector.id} collector={collector} />
            ))}
        </div>
      )}
    </div>
  );
}
