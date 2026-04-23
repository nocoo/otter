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
import { Skeleton } from "@/components/ui/skeleton";
import { formatSize } from "@/lib/utils";

const WHITESPACE_SPLIT = /\s+/;

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
  const words = content.trim() === "" ? 0 : content.trim().split(WHITESPACE_SPLIT).length;
  return { size: sizeBytes, lines, words };
}

// ---------------------------------------------------------------------------
// Code editor renderer
// ---------------------------------------------------------------------------

function CodeEditor({ tokens, lineCount }: { tokens: ThemedToken[][] | null; lineCount: number }) {
  const gutterWidth = `${Math.max(String(lineCount).length, 2)}ch`;

  if (!tokens) return null;

  return (
    <div className="font-mono text-xs leading-[1.7]">
      {tokens.map((lineTokens, lineIdx) => (
        <div
          // biome-ignore lint/suspicious/noArrayIndexKey: lines are positional, index is the natural key
          key={lineIdx}
          className="flex hover:bg-code-line-hover"
        >
          {/* Line number gutter */}
          <span
            className="shrink-0 select-none text-right pr-4 pl-4 sticky left-0 text-code-gutter-text bg-code-gutter-bg"
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

function PlainEditor({ content, lineCount }: { content: string; lineCount: number }) {
  const gutterWidth = `${Math.max(String(lineCount).length, 2)}ch`;
  const lines = content.split("\n");

  return (
    <div className="font-mono text-xs leading-[1.7]">
      {lines.map((line, lineIdx) => (
        <div
          // biome-ignore lint/suspicious/noArrayIndexKey: lines are positional, index is the natural key
          key={lineIdx}
          className="flex hover:bg-code-line-hover"
        >
          <span
            className="shrink-0 select-none text-right pr-4 pl-4 sticky left-0 text-code-gutter-text bg-code-gutter-bg"
            style={{ minWidth: `calc(${gutterWidth} + 2rem)` }}
          >
            {lineIdx + 1}
          </span>
          <span className="flex-1 whitespace-pre-wrap break-all pr-4 py-0 text-code-text">
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

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-6xl max-h-[85vh] flex flex-col p-0 gap-0 bg-code-bg border-code-border text-code-text [&_[data-slot=dialog-close]]:text-code-text-secondary [&_[data-slot=dialog-close]]:hover:text-code-text">
        {/* Header */}
        <DialogHeader className="px-5 pt-5 pb-3 border-b border-code-border shrink-0">
          <div className="flex items-center justify-between gap-3 pr-8">
            <div className="min-w-0">
              <DialogTitle className="text-sm font-medium truncate font-mono text-code-text">
                {filename}
              </DialogTitle>
              <DialogDescription className="text-xs mt-1 truncate text-code-text-secondary">
                {file?.path}
              </DialogDescription>
            </div>
            <Button
              variant="outline"
              size="xs"
              onClick={handleCopy}
              className="shrink-0 gap-1 border-code-border bg-code-btn-bg text-code-text hover:bg-code-btn-hover hover:text-code-text"
            >
              {copied ? (
                <Check className="h-3 w-3 text-success" strokeWidth={1.5} />
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
            <div className="px-4 py-4 space-y-2">
              {Array.from({ length: 12 }).map((_, i) => (
                // biome-ignore lint/suspicious/noArrayIndexKey: skeleton lines are static, never reorder
                <div key={`code-line-${i}`} className="flex gap-4">
                  <Skeleton className="h-4 w-8 shrink-0" />
                  <Skeleton className="h-4" style={{ width: `${Math.random() * 40 + 40}%` }} />
                </div>
              ))}
            </div>
          ) : tokens ? (
            <CodeEditor tokens={tokens} lineCount={lineCount} />
          ) : content ? (
            <PlainEditor content={content} lineCount={lineCount} />
          ) : (
            <div className="flex items-center justify-center py-12 text-sm text-code-text-secondary">
              No content available
            </div>
          )}
        </div>

        {/* Footer stats */}
        {stats && (
          <div className="px-5 py-3 border-t border-code-border flex items-center gap-4 text-xs text-code-text-secondary shrink-0">
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
