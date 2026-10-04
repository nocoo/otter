import {
  Button,
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  LayerCard,
} from "@nocoo/basalt";
import { useTheme } from "@nocoo/basalt/providers/theme";
import { Check, Copy, FileText, Hash, Type, X } from "lucide-react";
import { useCallback, useEffect, useState, useSyncExternalStore } from "react";
import { type BundledLanguage, codeToTokens, type ThemedToken } from "shiki";
import { formatSize } from "@/lib/utils";

const WHITESPACE_SPLIT = /\s+/;

function subscribeSystemTheme(callback: () => void) {
  const media = window.matchMedia("(prefers-color-scheme: dark)");
  media.addEventListener("change", callback);
  return () => media.removeEventListener("change", callback);
}

function getSystemIsDark() {
  return window.matchMedia("(prefers-color-scheme: dark)").matches;
}

function getServerIsDark() {
  return false;
}

function useIsDark() {
  const { theme } = useTheme();
  const systemIsDark = useSyncExternalStore(subscribeSystemTheme, getSystemIsDark, getServerIsDark);
  return theme === "dark" || (theme === "system" && systemIsDark);
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
          className="flex hover:bg-basalt-accent"
        >
          {/* Line number gutter */}
          <span
            className="shrink-0 select-none text-right pr-4 pl-4 sticky left-0 text-basalt-muted-foreground bg-basalt-bright"
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
          className="flex hover:bg-basalt-accent"
        >
          <span
            className="shrink-0 select-none text-right pr-4 pl-4 sticky left-0 text-basalt-muted-foreground bg-basalt-bright"
            style={{ minWidth: `calc(${gutterWidth} + 2rem)` }}
          >
            {lineIdx + 1}
          </span>
          <span className="flex-1 whitespace-pre-wrap break-all pr-4 py-0 text-basalt-foreground">
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
      <DialogContent size="xl" className="flex max-h-[85vh] flex-col gap-4 p-4 text-sm sm:p-5">
        <DialogClose asChild>
          <Button
            variant="ghost"
            size="icon"
            className="absolute right-3 top-3"
            aria-label="Close file viewer"
          >
            <X strokeWidth={1.5} aria-hidden="true" />
          </Button>
        </DialogClose>
        {/* Header */}
        <DialogHeader className="shrink-0">
          <div className="flex items-start justify-between gap-3 pr-8">
            <div className="min-w-0 space-y-1">
              <DialogTitle className="truncate text-base leading-6">{filename}</DialogTitle>
              <DialogDescription className="break-all text-xs leading-5">
                {file?.path}
              </DialogDescription>
            </div>
            <Button variant="outline" size="sm" onClick={handleCopy} className="shrink-0 gap-1">
              {copied ? (
                <Check className="h-3 w-3 text-basalt-heatmap-green-4" strokeWidth={1.5} />
              ) : (
                <Copy className="h-3 w-3" strokeWidth={1.5} />
              )}
              {copied ? "Copied" : "Copy"}
            </Button>
          </div>
        </DialogHeader>

        {/* Code editor area */}
        <LayerCard className="flex min-h-0 flex-1 flex-col" padding="none">
          <LayerCard.Well className="min-h-0 flex-1 overflow-auto px-0 py-2">
            {loading ? (
              <LayerCard.Loading label="Loading file content" />
            ) : tokens ? (
              <CodeEditor tokens={tokens} lineCount={lineCount} />
            ) : content ? (
              <PlainEditor content={content} lineCount={lineCount} />
            ) : (
              <div className="flex items-center justify-center py-12 text-sm text-basalt-muted-foreground">
                No content available
              </div>
            )}
          </LayerCard.Well>

          {/* Footer stats */}
          {stats && (
            <LayerCard.Footer className="shrink-0 justify-start gap-x-4 gap-y-2 py-2 text-xs text-basalt-muted-foreground">
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
            </LayerCard.Footer>
          )}
        </LayerCard>
      </DialogContent>
    </Dialog>
  );
}
