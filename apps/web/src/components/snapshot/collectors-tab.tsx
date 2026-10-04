import { Badge, Input, LayerCard } from "@nocoo/basalt";
import { filterCollectors, type SnapshotCollector } from "@otter/api/lib/snapshot-collectors";
import { useState } from "react";
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
          aria-label="Search collectors, files, items, or metadata"
        />
        <Badge variant="secondary" className="text-xs font-normal shrink-0">
          {filtered.length}/{categoryCollectors.length}
        </Badge>
      </div>

      {/* Collector cards */}
      {filtered.length === 0 ? (
        <LayerCard>
          <LayerCard.Empty title="No collectors match the current search." />
        </LayerCard>
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
