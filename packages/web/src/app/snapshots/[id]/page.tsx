"use client";

import { useState } from "react";
import { use } from "react";
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
} from "lucide-react";
import { AppShell } from "@/components/layout/app-shell";
import { Badge } from "@/components/ui/badge";

// ---------------------------------------------------------------------------
// Static placeholder data (Phase 1 — will be replaced by API call)
// ---------------------------------------------------------------------------

interface FileData {
  path: string;
  sizeBytes: number;
  preview: string;
}

interface ListItem {
  name: string;
  version?: string;
}

interface Collector {
  id: string;
  label: string;
  category: string;
  files: FileData[];
  lists: ListItem[];
  errors: string[];
}

interface SnapshotDetail {
  id: string;
  hostname: string;
  platform: string;
  arch: string;
  username: string;
  createdAt: string;
  sizeKb: number;
  collectors: Collector[];
}

const mockSnapshot: SnapshotDetail = {
  id: "a1b2c3d4",
  hostname: "nocoo-mbp",
  platform: "darwin",
  arch: "arm64",
  username: "nocoo",
  createdAt: "2026-03-06 11:30:00",
  sizeKb: 71,
  collectors: [
    {
      id: "claude-config",
      label: "Claude Config",
      category: "config",
      files: [
        { path: "/Users/nocoo/.claude/CLAUDE.md", sizeBytes: 3200, preview: "# Claude Configuration\n\n## Core interaction & personality\n..." },
        { path: "/Users/nocoo/.claude/settings.json", sizeBytes: 450, preview: '{\n  "model": "claude-opus-4",\n  "theme": "dark"\n}' },
      ],
      lists: [],
      errors: [],
    },
    {
      id: "opencode-config",
      label: "OpenCode Config",
      category: "config",
      files: [
        { path: "/Users/nocoo/.config/opencode/config.json", sizeBytes: 1800, preview: '{\n  "editor": "nvim",\n  "plugins": [...]\n}' },
      ],
      lists: [
        { name: "context7" },
        { name: "web-design-guidelines" },
        { name: "agent-browser" },
      ],
      errors: [],
    },
    {
      id: "shell-config",
      label: "Shell Config",
      category: "config",
      files: [
        { path: "/Users/nocoo/.zshrc", sizeBytes: 2400, preview: "# Zsh configuration\nexport PATH=...\nalias ll='ls -la'" },
        { path: "/Users/nocoo/.zprofile", sizeBytes: 800, preview: "# Zsh profile\neval $(/opt/homebrew/bin/brew shellenv)" },
        { path: "/Users/nocoo/.gitconfig", sizeBytes: 600, preview: "[user]\n  name = Nicholas\n  email = nicholasnoo@gmail.com" },
      ],
      lists: [],
      errors: [],
    },
    {
      id: "homebrew",
      label: "Homebrew",
      category: "environment",
      files: [],
      lists: [
        { name: "bat", version: "0.24.0" },
        { name: "fd", version: "10.2.0" },
        { name: "fzf", version: "0.57.0" },
        { name: "git", version: "2.47.1" },
        { name: "jq", version: "1.7.1" },
        { name: "neovim", version: "0.10.3" },
        { name: "ripgrep", version: "14.1.1" },
        { name: "sd", version: "1.0.0" },
        { name: "starship", version: "1.21.1" },
        { name: "tree", version: "2.2.1" },
      ],
      errors: [],
    },
    {
      id: "applications",
      label: "Applications",
      category: "environment",
      files: [],
      lists: [
        { name: "Arc", version: "1.70.0" },
        { name: "Discord", version: "0.0.331" },
        { name: "Figma", version: "124.5.3" },
        { name: "iTerm", version: "3.5.10" },
        { name: "Notion", version: "3.15.0" },
        { name: "Slack", version: "4.41.3" },
        { name: "Spotify", version: "1.2.52" },
        { name: "Visual Studio Code", version: "1.96.2" },
        { name: "Warp", version: "0.2025.01.01" },
        { name: "Xcode", version: "16.2" },
      ],
      errors: [],
    },
  ],
};

// ---------------------------------------------------------------------------
// Components
// ---------------------------------------------------------------------------

function CollectorSection({ collector }: { collector: Collector }) {
  const [expanded, setExpanded] = useState(true);
  const totalFiles = collector.files.length;
  const totalLists = collector.lists.length;

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
            <div className="space-y-2">
              <h4 className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Files</h4>
              {collector.files.map((file) => (
                <div key={file.path} className="rounded-lg bg-card p-3">
                  <div className="flex items-center justify-between mb-2">
                    <code className="text-xs font-mono text-foreground">{file.path}</code>
                    <span className="text-[10px] text-muted-foreground tabular-nums">
                      {file.sizeBytes > 1024
                        ? `${(file.sizeBytes / 1024).toFixed(1)} KB`
                        : `${file.sizeBytes} B`}
                    </span>
                  </div>
                  <pre className="text-xs text-muted-foreground font-mono whitespace-pre-wrap leading-relaxed bg-background/50 rounded-md p-2.5 overflow-x-auto max-h-32">
                    {file.preview}
                  </pre>
                </div>
              ))}
            </div>
          )}

          {/* Lists */}
          {collector.lists.length > 0 && (
            <div className="space-y-2">
              <h4 className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Items</h4>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-1.5">
                {collector.lists.map((item) => (
                  <div
                    key={item.name}
                    className="flex items-center justify-between rounded-lg bg-card px-3 py-2"
                  >
                    <span className="text-sm">{item.name}</span>
                    {item.version && (
                      <code className="text-[10px] text-muted-foreground font-mono">{item.version}</code>
                    )}
                  </div>
                ))}
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

  // Phase 1: always use mock data regardless of id
  const snapshot = { ...mockSnapshot, id };

  const totalFiles = snapshot.collectors.reduce((sum, c) => sum + c.files.length, 0);
  const totalLists = snapshot.collectors.reduce((sum, c) => sum + c.lists.length, 0);

  return (
    <AppShell breadcrumbs={[{ label: "Snapshots", href: "/snapshots" }, { label: id }]}>
      <div className="space-y-6">
        {/* Header */}
        <div>
          <div className="flex items-center gap-3">
            <h1 className="text-2xl font-semibold tracking-tight">
              Snapshot <code className="font-mono text-lg">{id}</code>
            </h1>
          </div>
          <p className="text-sm text-muted-foreground mt-1">
            Captured on {snapshot.createdAt}
          </p>
        </div>

        {/* Machine info cards */}
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
          <div className="rounded-xl bg-secondary p-4 flex items-center gap-3">
            <Monitor className="h-4 w-4 text-primary shrink-0" strokeWidth={1.5} />
            <div>
              <p className="text-[10px] text-muted-foreground uppercase tracking-wider">Host</p>
              <p className="text-sm font-medium">{snapshot.hostname}</p>
            </div>
          </div>
          <div className="rounded-xl bg-secondary p-4 flex items-center gap-3">
            <Cpu className="h-4 w-4 text-primary shrink-0" strokeWidth={1.5} />
            <div>
              <p className="text-[10px] text-muted-foreground uppercase tracking-wider">Platform</p>
              <p className="text-sm font-medium">{snapshot.platform}/{snapshot.arch}</p>
            </div>
          </div>
          <div className="rounded-xl bg-secondary p-4 flex items-center gap-3">
            <User className="h-4 w-4 text-primary shrink-0" strokeWidth={1.5} />
            <div>
              <p className="text-[10px] text-muted-foreground uppercase tracking-wider">User</p>
              <p className="text-sm font-medium">{snapshot.username}</p>
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
              <p className="text-sm font-medium">{snapshot.sizeKb} KB</p>
            </div>
          </div>
        </div>

        {/* Collectors */}
        <div className="space-y-3">
          <div className="flex items-center gap-2">
            <h2 className="text-sm font-medium text-foreground">Collectors</h2>
            <Badge variant="secondary" className="text-[10px] font-normal">
              {snapshot.collectors.length}
            </Badge>
          </div>
          {snapshot.collectors.map((collector) => (
            <CollectorSection key={collector.id} collector={collector} />
          ))}
        </div>

        {/* Raw JSON toggle (placeholder) */}
        <div className="rounded-xl bg-secondary p-5">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Clock className="h-4 w-4 text-muted-foreground" strokeWidth={1.5} />
              <span className="text-sm text-muted-foreground">
                Raw JSON export will be available when connected to R2 storage
              </span>
            </div>
          </div>
        </div>
      </div>
    </AppShell>
  );
}
