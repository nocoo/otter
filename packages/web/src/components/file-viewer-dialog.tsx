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
import { codeToTokens, type ThemedToken, type BundledLanguage } from "shiki";

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
  config: "ssh-config",
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
  config: "ssh-config",
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
// Code editor renderer
// ---------------------------------------------------------------------------

function CodeEditor({
  tokens,
  lineCount,
}: {
  tokens: ThemedToken[][] | null;
  lineCount: number;
}) {
  // Width of the gutter based on number of digits
  const gutterWidth = `${Math.max(String(lineCount).length, 2)}ch`;

  if (!tokens) {
    return null;
  }

  return (
    <div className="font-mono text-xs leading-[1.7]">
      {tokens.map((lineTokens, lineIdx) => (
        <div key={lineIdx} className="flex hover:bg-[#161b22]">
          {/* Line number gutter */}
          <span
            className="shrink-0 select-none text-right text-[#484f58] pr-4 pl-4 sticky left-0 bg-[#0d1117]"
            style={{ minWidth: `calc(${gutterWidth} + 2rem)` }}
          >
            {lineIdx + 1}
          </span>
          {/* Code content — wraps */}
          <span className="flex-1 whitespace-pre-wrap break-all pr-4 py-0">
            {lineTokens.length === 0 ? (
              "\n"
            ) : (
              lineTokens.map((token, tokenIdx) => (
                <span key={tokenIdx} style={{ color: token.color }}>
                  {token.content}
                </span>
              ))
            )}
          </span>
        </div>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Fallback plain text editor (no syntax highlighting)
// ---------------------------------------------------------------------------

function PlainEditor({
  content,
  lineCount,
}: {
  content: string;
  lineCount: number;
}) {
  const gutterWidth = `${Math.max(String(lineCount).length, 2)}ch`;
  const lines = content.split("\n");

  return (
    <div className="font-mono text-xs leading-[1.7]">
      {lines.map((line, lineIdx) => (
        <div key={lineIdx} className="flex hover:bg-[#161b22]">
          <span
            className="shrink-0 select-none text-right text-[#484f58] pr-4 pl-4 sticky left-0 bg-[#0d1117]"
            style={{ minWidth: `calc(${gutterWidth} + 2rem)` }}
          >
            {lineIdx + 1}
          </span>
          <span className="flex-1 whitespace-pre-wrap break-all pr-4 py-0 text-[#e6edf3]">
            {line || "\n"}
          </span>
        </div>
      ))}
    </div>
  );
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
  const [tokens, setTokens] = useState<ThemedToken[][] | null>(null);
  const [copied, setCopied] = useState(false);
  const [loading, setLoading] = useState(false);

  const content = file?.content ?? "";
  const stats = file ? computeFileStats(content, file.sizeBytes) : null;
  const lineCount = content ? content.split("\n").length : 0;

  useEffect(() => {
    if (!open || !file?.content) {
      setTokens(null);
      return;
    }

    let cancelled = false;
    setLoading(true);

    const lang = detectLanguage(file.path);

    codeToTokens(file.content, {
      lang: lang as BundledLanguage,
      theme: "github-dark-default",
    })
      .then((result) => {
        if (!cancelled) setTokens(result.tokens);
      })
      .catch(() => {
        // Fallback: try plaintext tokenization
        if (!cancelled) {
          codeToTokens(file.content!, {
            lang: "plaintext",
            theme: "github-dark-default",
          })
            .then((result) => {
              if (!cancelled) setTokens(result.tokens);
            })
            .catch(() => {
              // Give up on tokenization, will render PlainEditor
              if (!cancelled) setTokens(null);
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
      <DialogContent className="max-w-6xl max-h-[85vh] flex flex-col p-0 gap-0 bg-[#0d1117] border-[#30363d] text-[#e6edf3] [&_[data-slot=dialog-close]]:text-[#8b949e] [&_[data-slot=dialog-close]]:hover:text-[#e6edf3]">
        {/* Header */}
        <DialogHeader className="px-5 pt-5 pb-3 border-b border-[#30363d] shrink-0">
          <div className="flex items-center justify-between gap-3 pr-8">
            <div className="min-w-0">
              <DialogTitle className="text-sm font-medium truncate font-mono text-[#e6edf3]">
                {filename}
              </DialogTitle>
              <DialogDescription className="text-xs text-[#8b949e] mt-1 truncate">
                {file?.path}
              </DialogDescription>
            </div>
            <Button
              variant="outline"
              size="xs"
              onClick={handleCopy}
              className="shrink-0 gap-1 border-[#30363d] bg-[#21262d] text-[#e6edf3] hover:bg-[#30363d] hover:text-[#e6edf3]"
            >
              {copied ? (
                <Check className="h-3 w-3 text-green-400" strokeWidth={1.5} />
              ) : (
                <Copy className="h-3 w-3" strokeWidth={1.5} />
              )}
              {copied ? "Copied" : "Copy"}
            </Button>
          </div>
        </DialogHeader>

        {/* Code editor area */}
        <div className="flex-1 overflow-auto min-h-0 py-2">
          {loading ? (
            <div className="flex items-center justify-center py-12 text-sm text-[#8b949e]">
              Loading...
            </div>
          ) : tokens ? (
            <CodeEditor tokens={tokens} lineCount={lineCount} />
          ) : content ? (
            <PlainEditor content={content} lineCount={lineCount} />
          ) : (
            <div className="flex items-center justify-center py-12 text-sm text-[#8b949e]">
              No content available
            </div>
          )}
        </div>

        {/* Footer stats */}
        {stats && (
          <div className="px-5 py-3 border-t border-[#30363d] flex items-center gap-4 text-xs text-[#8b949e] shrink-0">
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
