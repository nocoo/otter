import { Button, LayerCard } from "@nocoo/basalt";
import { Check, Copy, Eye, FileText } from "lucide-react";
import { useCallback, useState } from "react";
import { FileViewerDialog } from "@/components/file-viewer-dialog";
import { formatSize } from "@/lib/utils";
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
      <LayerCard.Well className="flex items-center gap-3">
        <FileText className="h-3.5 w-3.5 text-basalt-muted-foreground shrink-0" strokeWidth={1.5} />
        <code
          className="text-xs font-mono text-basalt-foreground truncate flex-1"
          title={file.path}
        >
          {filename}
        </code>
        <span className="text-xs text-basalt-muted-foreground tabular-nums shrink-0">
          {formatSize(file.sizeBytes)}
        </span>
        <div className="flex items-center gap-1 shrink-0">
          {file.content && (
            <Button
              variant="ghost"
              size="icon"
              onClick={handleCopy}
              title={copied ? "Copied!" : "Copy content"}
              aria-label={copied ? "Copied!" : "Copy content"}
            >
              {copied ? (
                <Check className="h-3 w-3 text-basalt-heatmap-green-4" strokeWidth={1.5} />
              ) : (
                <Copy className="h-3 w-3" strokeWidth={1.5} />
              )}
            </Button>
          )}
          {file.content && (
            <Button
              variant="ghost"
              size="icon"
              onClick={() => setViewerOpen(true)}
              title="View file"
              aria-label="View file"
            >
              <Eye className="h-3 w-3" strokeWidth={1.5} />
            </Button>
          )}
        </div>
      </LayerCard.Well>
      <FileViewerDialog file={file} open={viewerOpen} onOpenChange={setViewerOpen} />
    </>
  );
}
