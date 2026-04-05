"use client";

import { AppWindow, CircleCheck } from "lucide-react";
import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { badgeClassName, formatMetaLabel, metaEntries } from "./helpers";
import type { ListItem } from "./types";

interface ListItemRowProps {
  item: ListItem;
  iconUrl?: string | undefined;
  isSshKey?: boolean | undefined;
}

export function ListItemRow({ item, iconUrl, isSshKey }: ListItemRowProps) {
  const entries = metaEntries(item.meta);
  const [iconError, setIconError] = useState(false);

  return (
    <div className="flex items-center gap-2.5 rounded-lg border border-border/50 bg-secondary px-3 py-2.5">
      {isSshKey ? (
        <CircleCheck className="h-4 w-4 text-success shrink-0" strokeWidth={1.5} />
      ) : iconUrl && !iconError ? (
        // biome-ignore lint/performance/noImgElement: external CDN icons, not local assets
        // biome-ignore lint/a11y/noNoninteractiveElementInteractions: onError is for image load fallback, not user interaction
        <img
          src={iconUrl}
          alt=""
          width={20}
          height={20}
          className="shrink-0 rounded-[4px]"
          loading="lazy"
          onError={() => setIconError(true)}
        />
      ) : iconUrl ? (
        <AppWindow className="h-5 w-5 text-muted-foreground shrink-0" strokeWidth={1.5} />
      ) : null}
      <div className="min-w-0 flex-1">
        <span className="text-sm truncate block">{item.name}</span>
        {entries.length > 0 && (
          <div className="mt-1 flex flex-wrap gap-1">
            {entries.map(([key, value]) => (
              <Badge
                key={`${item.name}-${key}`}
                variant="outline"
                className={cn("text-2xs font-normal", badgeClassName(key))}
              >
                {key === "type" ? value : `${formatMetaLabel(key)}: ${value}`}
              </Badge>
            ))}
          </div>
        )}
      </div>
      {item.version && (
        <code className="text-2xs text-muted-foreground font-mono shrink-0">{item.version}</code>
      )}
    </div>
  );
}
