"use client";

import { Check, Copy, Eye, FileText } from "lucide-react";
import { useCallback, useState } from "react";
import { FileViewerDialog } from "@/components/file-viewer-dialog";
import { Button } from "@/components/ui/button";
import { cn, formatSize } from "@/lib/utils";
import type { FileData } from "./types";

export function FileRow({ file }: { file: FileData }) {
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
      <div className="group relative flex items-center gap-3 rounded-lg border border-border/50 bg-card px-3 py-2.5 overflow-hidden hover:border-border hover:bg-accent/30 transition-colors">
        <div className="absolute left-0 top-0 bottom-0 w-0.5 bg-primary/40 rounded-full" />
        <FileText className="h-4 w-4 text-primary/60 shrink-0" strokeWidth={1.5} />
        <code className="text-xs font-mono text-foreground truncate flex-1" title={file.path}>
          {filename}
        </code>
        <span
          className={cn(
            "text-2xs tabular-nums shrink-0",
            file.sizeBytes > 100_000 ? "text-amber-500" : "text-muted-foreground",
          )}
        >
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
                <Check className="h-3 w-3 text-success" strokeWidth={1.5} />
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
      <FileViewerDialog file={file} open={viewerOpen} onOpenChange={setViewerOpen} />
    </>
  );
}
