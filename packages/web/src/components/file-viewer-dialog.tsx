"use client";

import { Check, Copy, FileText, Hash, Type } from "lucide-react";
import { useCallback, useEffect, useState, useSyncExternalStore } from "react";
import { type BundledLanguage, codeToTokens, type ThemedToken } from "shiki";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { formatSize } from "@/lib/utils";

// ---------------------------------------------------------------------------
// Theme detection (reuses the app's class-based dark mode)
// ---------------------------------------------------------------------------

function subscribeTheme(cb: () => void) {
  // Listen to manual toggle via custom event
  window.addEventListener("theme-change", cb);
  // Listen to OS-level scheme change
  const mq = window.matchMedia("(prefers-color-scheme: dark)");
  mq.addEventListener("change", cb);
  // Also observe class changes on <html> as a fallback
  const observer = new MutationObserver(cb);
  observer.observe(document.documentElement, {
    attributes: true,
    attributeFilter: ["class"],
  });
  return () => {
    window.removeEventListener("theme-change", cb);
    mq.removeEventListener("change", cb);
    observer.disconnect();
  };
}

function getIsDark() {
  return document.documentElement.classList.contains("dark");
}

function getServerIsDark() {
  return false;
}

function useIsDark() {
  return useSyncExternalStore(subscribeTheme, getIsDark, getServerIsDark);
}

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
  if (FILENAME_LANG_MAP[filename]) return FILENAME_LANG_MAP[filename];
  const dotIndex = filename.lastIndexOf(".");
  if (dotIndex !== -1) {
    const ext = filename.slice(dotIndex).toLowerCase();
    if (EXT_LANG_MAP[ext]) return EXT_LANG_MAP[ext];
  }
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
  isDark,
}: {
  tokens: ThemedToken[][] | null;
  lineCount: number;
  isDark: boolean;
}) {
  const gutterWidth = `${Math.max(String(lineCount).length, 2)}ch`;

  if (!tokens) return null;

  return (
    <div className="font-mono text-xs leading-[1.7]">
      {tokens.map((lineTokens, lineIdx) => (
        <div
          // biome-ignore lint/suspicious/noArrayIndexKey: lines are positional, index is the natural key
          key={lineIdx}
          className={isDark ? "flex hover:bg-[#161b22]" : "flex hover:bg-[#f3f4f6]"}
        >
          {/* Line number gutter */}
          <span
            className={`shrink-0 select-none text-right pr-4 pl-4 sticky left-0 ${
              isDark ? "text-[#484f58] bg-[#0d1117]" : "text-[#afb8c1] bg-[#ffffff]"
            }`}
            style={{ minWidth: `calc(${gutterWidth} + 2rem)` }}
          >
            {lineIdx + 1}
          </span>
          {/* Code content — wraps */}
          <span className="flex-1 whitespace-pre-wrap break-all pr-4 py-0">
            {lineTokens.length === 0
              ? "\n"
              : lineTokens.map((token, tokenIdx) => (
                  // biome-ignore lint/suspicious/noArrayIndexKey: tokens within a line are positional
                  <span key={tokenIdx} style={{ color: token.color }}>
                    {token.content}
                  </span>
                ))}
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
  isDark,
}: {
  content: string;
  lineCount: number;
  isDark: boolean;
}) {
  const gutterWidth = `${Math.max(String(lineCount).length, 2)}ch`;
  const lines = content.split("\n");

  return (
    <div className="font-mono text-xs leading-[1.7]">
      {lines.map((line, lineIdx) => (
        <div
          // biome-ignore lint/suspicious/noArrayIndexKey: lines are positional, index is the natural key
          key={lineIdx}
          className={isDark ? "flex hover:bg-[#161b22]" : "flex hover:bg-[#f3f4f6]"}
        >
          <span
            className={`shrink-0 select-none text-right pr-4 pl-4 sticky left-0 ${
              isDark ? "text-[#484f58] bg-[#0d1117]" : "text-[#afb8c1] bg-[#ffffff]"
            }`}
            style={{ minWidth: `calc(${gutterWidth} + 2rem)` }}
          >
            {lineIdx + 1}
          </span>
          <span
            className={`flex-1 whitespace-pre-wrap break-all pr-4 py-0 ${
              isDark ? "text-[#e6edf3]" : "text-[#1f2328]"
            }`}
          >
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

export function FileViewerDialog({ file, open, onOpenChange }: FileViewerDialogProps) {
  const isDark = useIsDark();
  const [tokens, setTokens] = useState<ThemedToken[][] | null>(null);
  const [copied, setCopied] = useState(false);
  const [loading, setLoading] = useState(false);

  const content = file?.content ?? "";
  const stats = file ? computeFileStats(content, file.sizeBytes) : null;
  const lineCount = content ? content.split("\n").length : 0;

  // Re-tokenize when file or theme changes
  useEffect(() => {
    if (!open || !file?.content) {
      setTokens(null);
      return;
    }

    let cancelled = false;
    setLoading(true);

    const lang = detectLanguage(file.path);
    const theme = isDark ? "github-dark-default" : "github-light-default";

    codeToTokens(file.content, {
      lang: lang as BundledLanguage,
      theme,
    })
      .then((result) => {
        if (!cancelled) setTokens(result.tokens);
      })
      .catch(() => {
        if (!cancelled) {
          codeToTokens(file.content ?? "", { lang: "plaintext", theme })
            .then((result) => {
              if (!cancelled) setTokens(result.tokens);
            })
            .catch(() => {
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
  }, [open, file?.path, file?.content, isDark]);

  const handleCopy = useCallback(async () => {
    if (!content) return;
    await navigator.clipboard.writeText(content);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }, [content]);

  const filename = file?.path.split("/").pop() ?? "";

  // Adaptive color tokens
  const bg = isDark ? "bg-[#0d1117]" : "bg-[#ffffff]";
  const border = isDark ? "border-[#30363d]" : "border-[#d1d9e0]";
  const textPrimary = isDark ? "text-[#e6edf3]" : "text-[#1f2328]";
  const textSecondary = isDark ? "text-[#8b949e]" : "text-[#656d76]";
  const btnBg = isDark
    ? "border-[#30363d] bg-[#21262d] text-[#e6edf3] hover:bg-[#30363d] hover:text-[#e6edf3]"
    : "border-[#d1d9e0] bg-[#f6f8fa] text-[#1f2328] hover:bg-[#eaeef2] hover:text-[#1f2328]";
  const closeBtn = isDark
    ? "[&_[data-slot=dialog-close]]:text-[#8b949e] [&_[data-slot=dialog-close]]:hover:text-[#e6edf3]"
    : "[&_[data-slot=dialog-close]]:text-[#656d76] [&_[data-slot=dialog-close]]:hover:text-[#1f2328]";

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className={`sm:max-w-6xl max-h-[85vh] flex flex-col p-0 gap-0 ${bg} ${border} ${textPrimary} ${closeBtn}`}
      >
        {/* Header */}
        <DialogHeader className={`px-5 pt-5 pb-3 border-b ${border} shrink-0`}>
          <div className="flex items-center justify-between gap-3 pr-8">
            <div className="min-w-0">
              <DialogTitle className={`text-sm font-medium truncate font-mono ${textPrimary}`}>
                {filename}
              </DialogTitle>
              <DialogDescription className={`text-xs mt-1 truncate ${textSecondary}`}>
                {file?.path}
              </DialogDescription>
            </div>
            <Button
              variant="outline"
              size="xs"
              onClick={handleCopy}
              className={`shrink-0 gap-1 ${btnBg}`}
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

        {/* Code editor area */}
        <div className="flex-1 overflow-auto min-h-0 py-2">
          {loading ? (
            <div className={`flex items-center justify-center py-12 text-sm ${textSecondary}`}>
              Loading...
            </div>
          ) : tokens ? (
            <CodeEditor tokens={tokens} lineCount={lineCount} isDark={isDark} />
          ) : content ? (
            <PlainEditor content={content} lineCount={lineCount} isDark={isDark} />
          ) : (
            <div className={`flex items-center justify-center py-12 text-sm ${textSecondary}`}>
              No content available
            </div>
          )}
        </div>

        {/* Footer stats */}
        {stats && (
          <div
            className={`px-5 py-3 border-t ${border} flex items-center gap-4 text-xs ${textSecondary} shrink-0`}
          >
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
