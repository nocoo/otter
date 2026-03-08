"use client";

import { CircleCheck } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { metaEntries, formatMetaLabel, badgeClassName } from "./helpers";
import type { ListItem } from "./types";

interface ListItemRowProps {
  item: ListItem;
  iconUrl?: string | undefined;
  isSshKey?: boolean | undefined;
}

export function ListItemRow({ item, iconUrl, isSshKey }: ListItemRowProps) {
  const entries = metaEntries(item.meta);

  return (
    <div className="flex items-center gap-2.5 rounded-lg bg-card px-3 py-2">
      {isSshKey ? (
        <CircleCheck className="h-4 w-4 text-success shrink-0" strokeWidth={1.5} />
      ) : iconUrl ? (
        <img
          src={iconUrl}
          alt=""
          width={20}
          height={20}
          className="shrink-0 rounded-[4px]"
          loading="lazy"
        />
      ) : null}
      <div className="min-w-0 flex-1">
        <span className="text-sm truncate block">{item.name}</span>
        {entries.length > 0 && (
          <div className="mt-1 flex flex-wrap gap-1">
            {entries.map(([key, value]) => (
              <Badge
                key={`${item.name}-${key}`}
                variant="outline"
                className={cn("text-[10px] font-normal", badgeClassName(key))}
              >
                {key === "type" ? value : `${formatMetaLabel(key)}: ${value}`}
              </Badge>
            ))}
          </div>
        )}
      </div>
      {item.version && (
        <code className="text-[10px] text-muted-foreground font-mono shrink-0">{item.version}</code>
      )}
    </div>
  );
}
