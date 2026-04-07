"use client";

import { AlertTriangle, FileText, Info, List, SkipForward } from "lucide-react";
import { useEffect, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { FileRow } from "./file-row";
import { computeIconUrl, listItemKey, resolveIconUrl } from "./helpers";
import { ListItemRow } from "./list-item-row";
import type { Collector } from "./types";

export function CollectorCard({ collector }: { collector: Collector }) {
  const [iconUrls, setIconUrls] = useState<Record<string, string>>({});
  const totalFiles = collector.files.length;
  const totalLists = collector.lists.length;
  const isApps = collector.id === "applications";
  const hasSshKeys = collector.lists.some((item) => item.meta?.source === ".ssh");
  const hasErrors = collector.errors.length > 0;
  const hasSkipped = (collector.skipped ?? []).length > 0;

  // Resolve icon URLs for application list items
  useEffect(() => {
    if (!isApps || totalLists === 0) return;
    const urls: Record<string, string> = {};
    const pending: Promise<void>[] = [];
    for (const item of collector.lists) {
      const existing = resolveIconUrl(item);
      if (existing) {
        urls[item.name] = existing;
      } else {
        pending.push(
          computeIconUrl(item.name).then((url) => {
            urls[item.name] = url;
          }),
        );
      }
    }
    if (pending.length === 0) {
      setIconUrls(urls);
    } else {
      Promise.all(pending).then(() => setIconUrls({ ...urls }));
    }
  }, [isApps, collector.lists, totalLists]);

  return (
    <Card className="gap-0 py-0 overflow-hidden">
      {/* Header */}
      <CardHeader className="gap-0 px-5 py-4 border-b border-border/40">
        <div className="flex items-center justify-between">
          <CardTitle className="text-sm">{collector.label}</CardTitle>
          <div className="flex items-center gap-3">
            {totalFiles > 0 && (
              <span className="text-xs text-muted-foreground flex items-center gap-1">
                <FileText className="h-3 w-3" strokeWidth={1.5} />
                {totalFiles}
              </span>
            )}
            {totalLists > 0 && (
              <span className="text-xs text-muted-foreground flex items-center gap-1">
                <List className="h-3 w-3" strokeWidth={1.5} />
                {totalLists}
              </span>
            )}
            {hasErrors && (
              <Badge
                variant="outline"
                className="text-2xs font-normal border-destructive/30 bg-destructive/10 text-destructive"
              >
                {collector.errors.length} error{collector.errors.length !== 1 ? "s" : ""}
              </Badge>
            )}
          </div>
        </div>
      </CardHeader>

      {/* Content */}
      <CardContent className="px-5 py-4">
        <div className="divide-y divide-border/30 [&>*]:py-3 first:[&>*]:pt-0 last:[&>*]:pb-0">
          {/* Files */}
          {totalFiles > 0 && (
            <div className="space-y-2">
              <h4 className="text-xs font-medium text-muted-foreground uppercase tracking-wider flex items-center gap-1.5">
                <FileText className="h-3 w-3" strokeWidth={1.5} />
                Files
              </h4>
              <div className="space-y-2">
                {collector.files.map((file) => (
                  <FileRow key={file.path} file={file} />
                ))}
              </div>
            </div>
          )}

          {/* Items */}
          {totalLists > 0 && (
            <div className="space-y-2">
              <h4 className="text-xs font-medium text-muted-foreground uppercase tracking-wider flex items-center gap-1.5">
                <List className="h-3 w-3" strokeWidth={1.5} />
                Items
              </h4>
              {hasSshKeys && (
                <p className="text-xs text-muted-foreground flex items-center gap-1.5">
                  <Info className="h-3 w-3 shrink-0" strokeWidth={1.5} />
                  Keys are detected only — content is never backed up.
                </p>
              )}
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
                {collector.lists.map((item, index) => {
                  const icon = isApps ? iconUrls[item.name] : item.meta?.iconUrl;
                  const isSshKey = item.meta?.source === ".ssh";
                  return (
                    <ListItemRow
                      key={listItemKey(item, index)}
                      item={item}
                      iconUrl={icon}
                      isSshKey={isSshKey}
                    />
                  );
                })}
              </div>
            </div>
          )}

          {/* Errors */}
          {hasErrors && (
            <div className="space-y-2">
              <h4 className="text-xs font-medium text-destructive uppercase tracking-wider flex items-center gap-1.5">
                <AlertTriangle className="h-3 w-3" strokeWidth={1.5} aria-hidden="true" />
                Errors
              </h4>
              <ul className="space-y-1.5">
                {collector.errors.map((err) => (
                  <li key={err} className="border-l-2 border-destructive/40 pl-3 py-1.5">
                    <p className="text-xs text-destructive/80">{err}</p>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* Skipped */}
          {hasSkipped && (
            <div className="space-y-2">
              <h4 className="text-xs font-medium text-muted-foreground uppercase tracking-wider flex items-center gap-1.5">
                <SkipForward className="h-3 w-3" strokeWidth={1.5} aria-hidden="true" />
                Skipped
              </h4>
              <ul className="space-y-1.5">
                {(collector.skipped ?? []).map((msg) => (
                  <li key={msg} className="border-l-2 border-border pl-3 py-1.5">
                    <p className="text-xs text-muted-foreground">{msg}</p>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
