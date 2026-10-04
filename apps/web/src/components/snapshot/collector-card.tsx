import { Badge, LayerCard } from "@nocoo/basalt";
import { SectionRule } from "@nocoo/basalt/components/section-rule";
import { AlertTriangle, FileText, Info, List, SkipForward } from "lucide-react";
import { useEffect, useState } from "react";
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
    <LayerCard>
      {/* Header */}
      <LayerCard.Header>
        <div className="flex w-full items-center justify-between gap-3">
          <h3 className="text-sm font-medium text-basalt-foreground">{collector.label}</h3>
          <div className="flex items-center gap-3">
            {totalFiles > 0 && (
              <span className="text-xs text-basalt-muted-foreground flex items-center gap-1">
                <FileText className="h-3 w-3" strokeWidth={1.5} />
                {totalFiles}
              </span>
            )}
            {totalLists > 0 && (
              <span className="text-xs text-basalt-muted-foreground flex items-center gap-1">
                <List className="h-3 w-3" strokeWidth={1.5} />
                {totalLists}
              </span>
            )}
            {hasErrors && (
              <Badge variant="error" className="text-xs font-normal">
                {collector.errors.length} error{collector.errors.length !== 1 ? "s" : ""}
              </Badge>
            )}
          </div>
        </div>
      </LayerCard.Header>

      {/* Content */}
      <LayerCard.Body>
        <div className="space-y-4">
          {/* Files */}
          {totalFiles > 0 && (
            <SectionRule title="Files">
              <div className="space-y-2">
                {collector.files.map((file) => (
                  <FileRow key={file.path} file={file} />
                ))}
              </div>
            </SectionRule>
          )}

          {/* Items */}
          {totalLists > 0 && (
            <SectionRule title="Items">
              {hasSshKeys && (
                <p className="text-xs text-basalt-muted-foreground flex items-center gap-1.5">
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
            </SectionRule>
          )}

          {/* Errors */}
          {hasErrors && (
            <SectionRule
              title={
                <span className="flex items-center gap-1.5 text-basalt-destructive">
                  <AlertTriangle className="h-3 w-3" strokeWidth={1.5} aria-hidden="true" />
                  Errors
                </span>
              }
            >
              <ul className="space-y-1.5">
                {collector.errors.map((err) => (
                  <li key={err} className="border-l-2 border-basalt-destructive/40 pl-3 py-1.5">
                    <p className="text-xs text-basalt-destructive/80">{err}</p>
                  </li>
                ))}
              </ul>
            </SectionRule>
          )}

          {/* Skipped */}
          {hasSkipped && (
            <SectionRule
              title={
                <span className="flex items-center gap-1.5">
                  <SkipForward className="h-3 w-3" strokeWidth={1.5} aria-hidden="true" />
                  Skipped
                </span>
              }
            >
              <ul className="space-y-1.5">
                {(collector.skipped ?? []).map((msg) => (
                  <li key={msg} className="border-l-2 border-basalt-border pl-3 py-1.5">
                    <p className="text-xs text-basalt-muted-foreground">{msg}</p>
                  </li>
                ))}
              </ul>
            </SectionRule>
          )}
        </div>
      </LayerCard.Body>
    </LayerCard>
  );
}
