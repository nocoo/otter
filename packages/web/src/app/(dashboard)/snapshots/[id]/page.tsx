"use client";

import { useState, useEffect, useCallback, use } from "react";
import {
  Monitor,
  FileText,
  List,
  ChevronDown,
  ChevronRight,
  Clock,
  HardDrive,
  Cpu,
  User,
  Archive,
  Loader2,
  Download,
  Eye,
  Copy,
  Check,
  CircleCheck,
  Info,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn, formatSize } from "@/lib/utils";
import { FileViewerDialog } from "@/components/file-viewer-dialog";
import {
  filterCollectors,
  groupCollectorsByCategory,
  getCollectorOverview,
  type SnapshotCollector,
} from "@/lib/snapshot-collectors";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type FileData = SnapshotCollector["files"][number];
type ListItem = SnapshotCollector["lists"][number];
type Collector = SnapshotCollector;

interface SnapshotMeta {
  id: string;
  hostname: string;
  platform: string;
  arch: string;
  username: string;
  collectorCount: number;
  fileCount: number;
  listCount: number;
  sizeBytes: number;
  snapshotAt: number;
  uploadedAt: number;
}

interface SnapshotData {
  version: number;
  id: string;
  createdAt: string;
  machine: {
    hostname: string;
    platform: string;
    arch: string;
    username: string;
  };
  collectors: Collector[];
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatDateTime(ts: number): string {
  return new Date(ts).toLocaleString("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

const ICON_BASE_URL = "https://s.zhe.to/apps/otter";

/**
 * Resolve the icon URL for a list item.
 * Uses meta.iconUrl if present, otherwise falls back to computing
 * a deterministic URL from the app name (for legacy snapshots).
 */
async function computeIconUrl(appName: string): Promise<string> {
  const data = new TextEncoder().encode(appName);
  const hashBuffer = await crypto.subtle.digest("SHA-256", data);
  const hex = Array.from(new Uint8Array(hashBuffer))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
  return `${ICON_BASE_URL}/${hex.slice(0, 12)}.png`;
}

function resolveIconUrl(item: ListItem): string | undefined {
  return item.meta?.iconUrl;
}

function metaEntries(meta?: Record<string, string>): Array<[string, string]> {
  if (!meta) return [];
  return Object.entries(meta).filter(([key]) => key !== "iconUrl");
}

function formatMetaLabel(key: string): string {
  return key.replace(/[-_]/g, " ");
}

function badgeClassName(key: string): string {
  if (key === "pinned" || key === "default" || key === "current") {
    return "border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300";
  }
  if (key === "type") {
    return "border-sky-500/30 bg-sky-500/10 text-sky-700 dark:text-sky-300";
  }
  return "border-border/60 bg-background/40 text-muted-foreground";
}

function listItemKey(item: ListItem, index: number): string {
  const meta = item.meta
    ? Object.entries(item.meta)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([key, value]) => `${key}:${value}`)
        .join("|")
    : "";

  return [item.name, item.version ?? "", meta, String(index)].join("::");
}

// ---------------------------------------------------------------------------
// Components
// ---------------------------------------------------------------------------

function FileRow({ file }: { file: FileData }) {
  const [viewerOpen, setViewerOpen] = useState(false);
  const [copied, setCopied] = useState(false);

  const filename = file.path.split("/").pop() ?? file.path;

  const handleCopy = useCallback(async () => {
    if (!file.content) return;
    await navigator.clipboard.writeText(file.content);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }, [file.content]);

  return (
    <>
      <div className="flex items-center gap-3 rounded-lg bg-card px-3 py-2">
        <FileText className="h-3.5 w-3.5 text-muted-foreground shrink-0" strokeWidth={1.5} />
        <code className="text-xs font-mono text-foreground truncate flex-1" title={file.path}>
          {filename}
        </code>
        <span className="text-[10px] text-muted-foreground tabular-nums shrink-0">
          {formatSize(file.sizeBytes)}
        </span>
        <div className="flex items-center gap-1 shrink-0">
          {file.content && (
            <Button
              variant="ghost"
              size="icon-xs"
              onClick={handleCopy}
              title={copied ? "Copied!" : "Copy content"}
            >
              {copied ? (
                <Check className="h-3 w-3 text-green-500" strokeWidth={1.5} />
              ) : (
                <Copy className="h-3 w-3" strokeWidth={1.5} />
              )}
            </Button>
          )}
          {file.content && (
            <Button
              variant="ghost"
              size="icon-xs"
              onClick={() => setViewerOpen(true)}
              title="View file"
            >
              <Eye className="h-3 w-3" strokeWidth={1.5} />
            </Button>
          )}
        </div>
      </div>
      <FileViewerDialog
        file={file}
        open={viewerOpen}
        onOpenChange={setViewerOpen}
      />
    </>
  );
}

function CollectorSection({ collector }: { collector: Collector }) {
  const [expanded, setExpanded] = useState(true);
  const [iconUrls, setIconUrls] = useState<Record<string, string>>({});
  const totalFiles = collector.files.length;
  const totalLists = collector.lists.length;
  const isApps = collector.id === "applications";
  const hasSshKeys = collector.lists.some((item) => item.meta?.source === ".ssh");

  // Resolve icon URLs for application list items (handles legacy snapshots without meta.iconUrl)
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
    <div className="rounded-xl bg-secondary overflow-hidden">
      {/* Collector header */}
      <button
        onClick={() => setExpanded(!expanded)}
        className="flex w-full items-center gap-3 px-5 py-4 text-left hover:bg-accent/50 transition-colors cursor-pointer"
      >
        {expanded ? (
          <ChevronDown className="h-4 w-4 text-muted-foreground shrink-0" strokeWidth={1.5} />
        ) : (
          <ChevronRight className="h-4 w-4 text-muted-foreground shrink-0" strokeWidth={1.5} />
        )}
        <span className="font-medium text-sm">{collector.label}</span>
        <Badge variant="secondary" className="text-[10px] font-normal">
          {collector.category}
        </Badge>
        <div className="flex-1" />
        {totalFiles > 0 && (
          <span className="text-xs text-muted-foreground flex items-center gap-1">
            <FileText className="h-3 w-3" strokeWidth={1.5} />
            {totalFiles} file{totalFiles !== 1 ? "s" : ""}
          </span>
        )}
        {totalLists > 0 && (
          <span className="text-xs text-muted-foreground flex items-center gap-1 ml-3">
            <List className="h-3 w-3" strokeWidth={1.5} />
            {totalLists} item{totalLists !== 1 ? "s" : ""}
          </span>
        )}
      </button>

      {/* Expanded content */}
      {expanded && (
        <div className="border-t border-border/50 px-5 py-4 space-y-4">
          {/* Files */}
          {collector.files.length > 0 && (
            <div className="space-y-1.5">
              <h4 className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Files</h4>
              {collector.files.map((file) => (
                <FileRow key={file.path} file={file} />
              ))}
            </div>
          )}

          {/* Lists */}
          {collector.lists.length > 0 && (
            <div className="space-y-2">
              <h4 className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Items</h4>
              {hasSshKeys && (
                <p className="text-xs text-muted-foreground flex items-center gap-1.5">
                  <Info className="h-3 w-3 shrink-0" strokeWidth={1.5} />
                  Keys are detected only — content is never backed up.
                </p>
              )}
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-1.5">
                {collector.lists.map((item, index) => {
                  const icon = isApps ? iconUrls[item.name] : item.meta?.iconUrl;
                  const isSshKey = item.meta?.source === ".ssh";
                  return (
                    <div
                      key={listItemKey(item, index)}
                      className="flex items-center gap-2.5 rounded-lg bg-card px-3 py-2"
                    >
                      {isSshKey ? (
                        <CircleCheck className="h-4 w-4 text-green-500 shrink-0" strokeWidth={1.5} />
                      ) : icon ? (
                        <img
                          src={icon}
                          alt=""
                          width={20}
                          height={20}
                          className="shrink-0 rounded-[4px]"
                          loading="lazy"
                        />
                       ) : null}
                       <div className="min-w-0 flex-1">
                         <span className="text-sm truncate block">{item.name}</span>
                         {metaEntries(item.meta).length > 0 && (
                           <div className="mt-1 flex flex-wrap gap-1">
                             {metaEntries(item.meta).map(([key, value]) => (
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
                         <code className="text-[10px] text-muted-foreground font-mono">{item.version}</code>
                       )}
                     </div>
                   );
                 })}
              </div>
            </div>
          )}

          {/* Errors */}
          {collector.errors.length > 0 && (
            <div className="space-y-1">
              <h4 className="text-xs font-medium text-destructive uppercase tracking-wider">Errors</h4>
              {collector.errors.map((err, i) => (
                <p key={i} className="text-xs text-destructive/80">{err}</p>
              ))}
            </div>
          )}

          {/* Skipped (tools not installed — informational) */}
          {(collector.skipped ?? []).length > 0 && (
            <div className="space-y-1">
              <h4 className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Skipped</h4>
              {(collector.skipped ?? []).map((msg, i) => (
                <p key={i} className="text-xs text-muted-foreground">{msg}</p>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function CollectorGroupSection({
  category,
  collectors,
  totalFiles,
  totalLists,
  withErrors,
}: {
  category: string;
  collectors: Collector[];
  totalFiles: number;
  totalLists: number;
  withErrors: number;
}) {
  const [expanded, setExpanded] = useState(true);

  return (
    <section className="space-y-3 rounded-2xl border border-border/60 bg-secondary/70 p-3 sm:p-4">
      <button
        type="button"
        onClick={() => setExpanded((value) => !value)}
        className="flex w-full items-center gap-3 rounded-xl px-2 py-2 text-left hover:bg-accent/40 transition-colors"
      >
        {expanded ? (
          <ChevronDown className="h-4 w-4 text-muted-foreground shrink-0" strokeWidth={1.5} />
        ) : (
          <ChevronRight className="h-4 w-4 text-muted-foreground shrink-0" strokeWidth={1.5} />
        )}
        <div>
          <p className="text-sm font-medium capitalize">{category}</p>
          <p className="text-xs text-muted-foreground">
            {collectors.length} collector{collectors.length !== 1 ? "s" : ""} · {totalFiles} files · {totalLists} items
          </p>
        </div>
        <div className="ml-auto flex flex-wrap gap-2">
          <Badge variant="secondary" className="text-[10px] font-normal">
            {collectors.length}
          </Badge>
          {withErrors > 0 && (
            <Badge variant="outline" className="text-[10px] font-normal border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-300">
              {withErrors} with errors
            </Badge>
          )}
        </div>
      </button>

      {expanded && (
        <div className="space-y-3">
          {collectors.map((collector) => (
            <CollectorSection key={collector.id} collector={collector} />
          ))}
        </div>
      )}
    </section>
  );
}

export default function SnapshotDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);
  const [meta, setMeta] = useState<SnapshotMeta | null>(null);
  const [data, setData] = useState<SnapshotData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [collectorQuery, setCollectorQuery] = useState("");
  const [collectorCategory, setCollectorCategory] = useState("all");

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

  const handleDownload = () => {
    if (!data) return;
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `snapshot-${id}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

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
  const filteredCollectors = filterCollectors(collectors, {
    query: collectorQuery,
    category: collectorCategory,
  });
  const groupedCollectors = groupCollectorsByCategory(filteredCollectors);
  const overview = getCollectorOverview(collectors, filteredCollectors);
  const totalFiles = collectors.reduce((sum, c) => sum + c.files.length, 0);
  const totalLists = collectors.reduce((sum, c) => sum + c.lists.length, 0);

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

      {/* Machine info cards */}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
        <div className="rounded-xl bg-secondary p-4 flex items-center gap-3">
          <Monitor className="h-4 w-4 text-primary shrink-0" strokeWidth={1.5} />
          <div>
            <p className="text-[10px] text-muted-foreground uppercase tracking-wider">Host</p>
            <p className="text-sm font-medium">{meta.hostname}</p>
          </div>
        </div>
        <div className="rounded-xl bg-secondary p-4 flex items-center gap-3">
          <Cpu className="h-4 w-4 text-primary shrink-0" strokeWidth={1.5} />
          <div>
            <p className="text-[10px] text-muted-foreground uppercase tracking-wider">Platform</p>
            <p className="text-sm font-medium">{meta.platform}/{meta.arch}</p>
          </div>
        </div>
        <div className="rounded-xl bg-secondary p-4 flex items-center gap-3">
          <User className="h-4 w-4 text-primary shrink-0" strokeWidth={1.5} />
          <div>
            <p className="text-[10px] text-muted-foreground uppercase tracking-wider">User</p>
            <p className="text-sm font-medium">{meta.username}</p>
          </div>
        </div>
        <div className="rounded-xl bg-secondary p-4 flex items-center gap-3">
          <Archive className="h-4 w-4 text-primary shrink-0" strokeWidth={1.5} />
          <div>
            <p className="text-[10px] text-muted-foreground uppercase tracking-wider">Content</p>
            <p className="text-sm font-medium">{totalFiles} files, {totalLists} items</p>
          </div>
        </div>
        <div className="rounded-xl bg-secondary p-4 flex items-center gap-3">
          <HardDrive className="h-4 w-4 text-primary shrink-0" strokeWidth={1.5} />
          <div>
            <p className="text-[10px] text-muted-foreground uppercase tracking-wider">Size</p>
            <p className="text-sm font-medium">{formatSize(meta.sizeBytes)}</p>
          </div>
        </div>
      </div>

      {/* Collectors */}
      <div className="space-y-3">
        <div className="flex flex-col gap-3 rounded-xl bg-secondary p-4 sm:p-5">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex items-center gap-2">
              <h2 className="text-sm font-medium text-foreground">Collectors</h2>
              <Badge variant="secondary" className="text-[10px] font-normal">
                {overview.visible}/{overview.total}
              </Badge>
            </div>
            <div className="flex flex-wrap gap-2">
              <Badge variant="outline" className="text-[10px] font-normal">config {overview.config}</Badge>
              <Badge variant="outline" className="text-[10px] font-normal">environment {overview.environment}</Badge>
              <Badge variant="outline" className="text-[10px] font-normal">errors {overview.withErrors}</Badge>
            </div>
          </div>

          <div className="flex flex-col gap-3 lg:flex-row lg:items-center">
            <Input
              value={collectorQuery}
              onChange={(event) => setCollectorQuery(event.target.value)}
              placeholder="Search collectors, files, items, or metadata..."
              className="bg-background/70"
            />
            <div className="flex rounded-lg border border-border bg-background/60 p-1">
              {[
                { label: "All", value: "all" },
                { label: "Config", value: "config" },
                { label: "Environment", value: "environment" },
              ].map((option) => (
                <button
                  key={option.value}
                  type="button"
                  onClick={() => setCollectorCategory(option.value)}
                  className={cn(
                    "rounded-md px-3 py-1.5 text-xs transition-colors",
                    collectorCategory === option.value
                      ? "bg-primary text-primary-foreground"
                      : "text-muted-foreground hover:text-foreground"
                  )}
                >
                  {option.label}
                </button>
              ))}
            </div>
          </div>
        </div>

        {filteredCollectors.length === 0 ? (
          <div className="rounded-xl border border-dashed border-border bg-secondary/60 px-5 py-8 text-center">
            <p className="text-sm text-muted-foreground">No collectors match the current filters.</p>
          </div>
        ) : groupedCollectors.map((group) => (
          <CollectorGroupSection key={group.category} {...group} />
        ))}
      </div>

      {/* Raw JSON download */}
      <div className="rounded-xl bg-secondary p-5">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Clock className="h-4 w-4 text-muted-foreground" strokeWidth={1.5} />
            <span className="text-sm text-muted-foreground">
              Download the full snapshot as JSON
            </span>
          </div>
          <Button variant="outline" size="sm" className="gap-1.5" onClick={handleDownload}>
            <Download className="h-3.5 w-3.5" strokeWidth={1.5} />
            Export JSON
          </Button>
        </div>
      </div>
    </div>
  );
}
