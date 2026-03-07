"use client";

import { useState, useEffect, useCallback } from "react";
import { Copy, Check, FileText, Hash, Type } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { formatSize } from "@/lib/utils";
import { codeToHtml } from "shiki";

// ---------------------------------------------------------------------------
// Language detection
// ---------------------------------------------------------------------------

const EXT_LANG_MAP: Record<string, string> = {
  // Shell / dotfiles
  ".zshrc": "shellscript",
  ".bashrc": "shellscript",
  ".bash_profile": "shellscript",
  ".profile": "shellscript",
  ".zprofile": "shellscript",
  ".zshenv": "shellscript",
  ".sh": "shellscript",

  // Config
  ".json": "json",
  ".jsonl": "json",
  ".toml": "toml",
  ".yaml": "yaml",
  ".yml": "yaml",
  ".xml": "xml",
  ".plist": "xml",
  ".ini": "ini",
  ".conf": "ini",

  // Markup / docs
  ".md": "markdown",
  ".mdx": "markdown",
  ".txt": "plaintext",

  // Code
  ".ts": "typescript",
  ".tsx": "tsx",
  ".js": "javascript",
  ".jsx": "jsx",
  ".py": "python",
  ".rb": "ruby",
  ".rs": "rust",
  ".go": "go",
  ".lua": "lua",
  ".vim": "viml",

  // Git
  ".gitconfig": "ini",
  ".gitignore": "gitignore",

  // SSH
  ".pub": "plaintext",
  "config": "ssh-config",
};

/** Known full filenames that map to a language */
const FILENAME_LANG_MAP: Record<string, string> = {
  Brewfile: "ruby",
  Gemfile: "ruby",
  Makefile: "makefile",
  Dockerfile: "dockerfile",
  CLAUDE: "markdown",
  "CLAUDE.md": "markdown",
  ".gitconfig": "ini",
  ".gitignore": "gitignore",
  "settings.json": "json",
  "config": "ssh-config",
};

function detectLanguage(filePath: string): string {
  const filename = filePath.split("/").pop() ?? "";

  // Check full filename first
  if (FILENAME_LANG_MAP[filename]) return FILENAME_LANG_MAP[filename];

  // Check extension
  const dotIndex = filename.lastIndexOf(".");
  if (dotIndex !== -1) {
    const ext = filename.slice(dotIndex).toLowerCase();
    if (EXT_LANG_MAP[ext]) return EXT_LANG_MAP[ext];
  }

  // Dotfiles without extension are usually shell config
  if (filename.startsWith(".")) return "shellscript";

  return "plaintext";
}

// ---------------------------------------------------------------------------
// File stats
// ---------------------------------------------------------------------------

interface FileStats {
  size: number;
  lines: number;
  words: number;
}

function computeFileStats(content: string, sizeBytes: number): FileStats {
  const lines = content.split("\n").length;
  const words = content.trim() === "" ? 0 : content.trim().split(/\s+/).length;
  return { size: sizeBytes, lines, words };
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

interface FileViewerDialogProps {
  file: { path: string; sizeBytes: number; content?: string } | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function FileViewerDialog({
  file,
  open,
  onOpenChange,
}: FileViewerDialogProps) {
  const [highlightedHtml, setHighlightedHtml] = useState<string>("");
  const [copied, setCopied] = useState(false);
  const [loading, setLoading] = useState(false);

  const content = file?.content ?? "";
  const stats = file ? computeFileStats(content, file.sizeBytes) : null;

  useEffect(() => {
    if (!open || !file?.content) {
      setHighlightedHtml("");
      return;
    }

    let cancelled = false;
    setLoading(true);

    const lang = detectLanguage(file.path);

    codeToHtml(file.content, {
      lang,
      theme: "github-dark-default",
    })
      .then((html) => {
        if (!cancelled) setHighlightedHtml(html);
      })
      .catch(() => {
        // Fallback: if the language isn't supported, try plaintext
        if (!cancelled) {
          codeToHtml(file.content!, { lang: "plaintext", theme: "github-dark-default" })
            .then((html) => {
              if (!cancelled) setHighlightedHtml(html);
            })
            .catch(() => {
              if (!cancelled) setHighlightedHtml("");
            });
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [open, file?.path, file?.content]);

  const handleCopy = useCallback(async () => {
    if (!content) return;
    await navigator.clipboard.writeText(content);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }, [content]);

  const filename = file?.path.split("/").pop() ?? "";

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl max-h-[85vh] flex flex-col p-0 gap-0">
        {/* Header */}
        <DialogHeader className="px-5 pt-5 pb-3 border-b border-border/50 shrink-0">
          <div className="flex items-center justify-between gap-3 pr-8">
            <div className="min-w-0">
              <DialogTitle className="text-sm font-medium truncate font-mono">
                {filename}
              </DialogTitle>
              <DialogDescription className="text-xs text-muted-foreground mt-1 truncate">
                {file?.path}
              </DialogDescription>
            </div>
            <Button
              variant="outline"
              size="xs"
              onClick={handleCopy}
              className="shrink-0 gap-1"
            >
              {copied ? (
                <Check className="h-3 w-3 text-green-500" strokeWidth={1.5} />
              ) : (
                <Copy className="h-3 w-3" strokeWidth={1.5} />
              )}
              {copied ? "Copied" : "Copy"}
            </Button>
          </div>
        </DialogHeader>

        {/* Code content */}
        <div className="flex-1 overflow-auto min-h-0">
          {loading ? (
            <div className="flex items-center justify-center py-12 text-sm text-muted-foreground">
              Loading...
            </div>
          ) : highlightedHtml ? (
            <div
              className="text-xs leading-relaxed [&_pre]:!bg-transparent [&_pre]:p-4 [&_pre]:m-0 [&_code]:!text-xs overflow-x-auto"
              dangerouslySetInnerHTML={{ __html: highlightedHtml }}
            />
          ) : content ? (
            <pre className="text-xs text-muted-foreground font-mono whitespace-pre-wrap leading-relaxed p-4 overflow-x-auto">
              {content}
            </pre>
          ) : (
            <div className="flex items-center justify-center py-12 text-sm text-muted-foreground">
              No content available
            </div>
          )}
        </div>

        {/* Footer stats */}
        {stats && (
          <div className="px-5 py-3 border-t border-border/50 flex items-center gap-4 text-xs text-muted-foreground shrink-0 bg-muted/30">
            <span className="flex items-center gap-1.5">
              <FileText className="h-3 w-3" strokeWidth={1.5} />
              {formatSize(stats.size)}
            </span>
            <span className="flex items-center gap-1.5">
              <Hash className="h-3 w-3" strokeWidth={1.5} />
              {stats.lines.toLocaleString()} line{stats.lines !== 1 ? "s" : ""}
            </span>
            <span className="flex items-center gap-1.5">
              <Type className="h-3 w-3" strokeWidth={1.5} />
              {stats.words.toLocaleString()} word{stats.words !== 1 ? "s" : ""}
            </span>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
