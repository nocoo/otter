"use client";

import { useState, useEffect } from "react";
import { FileText, List, Info, AlertTriangle, SkipForward } from "lucide-react";
import {
  Card,
  CardHeader,
  CardTitle,
  CardContent,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { FileRow } from "./file-row";
import { ListItemRow } from "./list-item-row";
import { resolveIconUrl, computeIconUrl, listItemKey } from "./helpers";
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
              <Badge variant="outline" className="text-[10px] font-normal border-destructive/30 bg-destructive/10 text-destructive">
                {collector.errors.length} error{collector.errors.length !== 1 ? "s" : ""}
              </Badge>
            )}
          </div>
        </div>
      </CardHeader>

      {/* Content */}
      <CardContent className="px-5 py-5">
        <div className="divide-y divide-border/30 [&>*]:py-5 first:[&>*]:pt-0 last:[&>*]:pb-0">
          {/* Files */}
          {totalFiles > 0 && (
            <div className="space-y-2">
              <h4 className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider flex items-center gap-1.5">
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
              <h4 className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider flex items-center gap-1.5">
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
              <h4 className="text-[11px] font-medium text-destructive uppercase tracking-wider flex items-center gap-1.5">
                <AlertTriangle className="h-3 w-3" strokeWidth={1.5} />
                Errors
              </h4>
              <div className="space-y-1.5">
                {collector.errors.map((err, i) => (
                  <div key={i} className="rounded-lg border border-destructive/20 bg-destructive/5 px-3 py-2">
                    <p className="text-xs text-destructive/90">{err}</p>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Skipped */}
          {hasSkipped && (
            <div className="space-y-2">
              <h4 className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider flex items-center gap-1.5">
                <SkipForward className="h-3 w-3" strokeWidth={1.5} />
                Skipped
              </h4>
              <div className="space-y-1.5">
                {(collector.skipped ?? []).map((msg, i) => (
                  <div key={i} className="rounded-lg border border-border/50 bg-secondary px-3 py-2">
                    <p className="text-xs text-muted-foreground">{msg}</p>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
