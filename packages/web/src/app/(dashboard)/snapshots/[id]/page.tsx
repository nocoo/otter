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
import { formatSize } from "@/lib/utils";
import { FileViewerDialog } from "@/components/file-viewer-dialog";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface FileData {
  path: string;
  sizeBytes: number;
  content?: string;
}

interface ListItem {
  name: string;
  version?: string;
  meta?: Record<string, string>;
}

interface Collector {
  id: string;
  label: string;
  category: string;
  files: FileData[];
  lists: ListItem[];
  errors: string[];
}

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
                {collector.lists.map((item) => {
                  const icon = isApps ? iconUrls[item.name] : item.meta?.iconUrl;
                  const isSshKey = item.meta?.source === ".ssh";
                  return (
                    <div
                      key={item.name}
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
                      <span className="text-sm truncate flex-1">{item.name}</span>
                      {item.version && (
                        <code className="text-[10px] text-muted-foreground font-mono">{item.version}</code>
                      )}
                      {isSshKey && item.meta?.type && (
                        <Badge variant="secondary" className="text-[10px] font-normal">
                          {item.meta.type}
                        </Badge>
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
        </div>
      )}
    </div>
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
        <div className="flex items-center gap-2">
          <h2 className="text-sm font-medium text-foreground">Collectors</h2>
          <Badge variant="secondary" className="text-[10px] font-normal">
            {collectors.length}
          </Badge>
        </div>
        {collectors.map((collector) => (
          <CollectorSection key={collector.id} collector={collector} />
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
