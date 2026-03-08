import type { Snapshot, CollectorResult } from "../../core/src/types";

export const ALL_COLLECTOR_IDS = [
  "claude-config",
  "opencode-config",
  "shell-config",
  "homebrew",
  "applications",
  "vscode",
  "docker",
  "fonts",
  "dev-toolchain",
  "cloud-cli",
  "macos-defaults",
  "launch-agents",
] as const;

function collectorFile(path: string, content: string) {
  return {
    path,
    content,
    sizeBytes: Buffer.byteLength(content, "utf-8"),
  };
}

export function buildRichSnapshotFixture(snapshotId: string): Snapshot {
  const createdAt = new Date().toISOString();

  return {
    version: 1,
    id: snapshotId,
    createdAt,
    machine: {
      hostname: "otter-rich-mac",
      computerName: "Otter Rich Mac",
      platform: "darwin",
      osVersion: "15.3.1",
      arch: "arm64",
      username: "e2e-tester",
      homeDir: "/Users/e2e-tester",
      nodeVersion: "22.16.0",
    },
    collectors: [
      {
        id: "claude-config",
        label: "Claude Code Configuration",
        category: "config",
        files: [
          collectorFile(
            "/Users/e2e-tester/.claude/settings.json",
            '{"theme":"light","apiKey":"[REDACTED]"}'
          ),
        ],
        lists: [{ name: "claude-session-count", version: "4", meta: { type: "summary" } }],
        errors: [],
        skipped: [],
        durationMs: 25,
      },
      {
        id: "opencode-config",
        label: "OpenCode Configuration",
        category: "config",
        files: [
          collectorFile(
            "/Users/e2e-tester/.config/opencode/config.json",
            '{"provider":"anthropic","token":"[REDACTED]"}'
          ),
        ],
        lists: [{ name: "web-design-guidelines", meta: { type: "skill" } }],
        errors: [],
        skipped: [],
        durationMs: 18,
      },
      {
        id: "shell-config",
        label: "Shell Configuration",
        category: "environment",
        files: [
          collectorFile(
            "/Users/e2e-tester/.zshrc",
            'export PATH="/opt/homebrew/bin:$PATH"\nexport OPENAI_API_KEY="[REDACTED]"'
          ),
        ],
        lists: [
          { name: "~/.ssh/id_ed25519", meta: { type: "ssh-key", source: ".ssh" } },
        ],
        errors: [],
        skipped: [],
        durationMs: 20,
      },
      {
        id: "homebrew",
        label: "Homebrew Packages",
        category: "environment",
        files: [],
        lists: [
          { name: "bun", version: "1.3.9", meta: { type: "formula", pinned: "true" } },
          { name: "docker", version: "28.0.4", meta: { type: "cask" } },
          { name: "homebrew/cask", meta: { type: "tap" } },
        ],
        errors: [],
        skipped: [],
        durationMs: 42,
      },
      {
        id: "applications",
        label: "Installed Applications",
        category: "environment",
        files: [],
        lists: [
          {
            name: "Docker",
            version: "4.39.0",
            meta: { iconUrl: "https://s.zhe.to/apps/otter/docker.png" },
          },
          {
            name: "Cursor",
            version: "1.2.4",
            meta: { iconUrl: "https://s.zhe.to/apps/otter/cursor.png" },
          },
        ],
        errors: [],
        skipped: [],
        durationMs: 28,
      },
      {
        id: "vscode",
        label: "VS Code / Cursor Configuration",
        category: "config",
        files: [
          collectorFile(
            "/Users/e2e-tester/Library/Application Support/Code/User/settings.json",
            '{"editor.fontFamily":"MonoLisa","github.copilot.chat.localeOverride":"en","token":"[REDACTED]"}'
          ),
          collectorFile(
            "/Users/e2e-tester/Library/Application Support/Cursor/User/keybindings.json",
            '[{"key":"cmd+k cmd+s","command":"workbench.action.openGlobalKeybindings"}]'
          ),
        ],
        lists: [
          {
            name: "github.copilot",
            version: "1.300.0",
            meta: { type: "vscode-extension", editor: "vscode" },
          },
          {
            name: "ms-python.python",
            version: "2026.4.0",
            meta: { type: "vscode-extension", editor: "cursor" },
          },
        ],
        errors: [],
        skipped: [],
        durationMs: 37,
      },
      {
        id: "docker",
        label: "Docker Configuration",
        category: "environment",
        files: [
          collectorFile(
            "/Users/e2e-tester/.docker/config.json",
            '{"auths":{"ghcr.io":{"auth":"[REDACTED]"}},"credsStore":"desktop"}'
          ),
        ],
        lists: [
          {
            name: "desktop-linux",
            meta: {
              type: "docker-context",
              current: "true",
              endpoint: "unix:///Users/e2e-tester/.docker/run/docker.sock",
            },
          },
        ],
        errors: [],
        skipped: [],
        durationMs: 21,
      },
      {
        id: "fonts",
        label: "Installed Fonts",
        category: "environment",
        files: [],
        lists: [
          { name: "MonoLisa", meta: { type: "font", format: "otf" } },
          { name: "JetBrainsMono", meta: { type: "font", format: "ttf" } },
        ],
        errors: [],
        skipped: [],
        durationMs: 9,
      },
      {
        id: "dev-toolchain",
        label: "Development Toolchain",
        category: "environment",
        files: [],
        lists: [
          {
            name: "node/v24.13.0",
            version: "24.13.0",
            meta: { type: "node-version", manager: "fnm", default: "true" },
          },
          { name: "vercel", version: "50.2.1", meta: { type: "npm-global" } },
          { name: "go", version: "1.24.0", meta: { type: "go-version" } },
        ],
        errors: [],
        skipped: ["Skipped pyenv: not installed"],
        durationMs: 33,
      },
      {
        id: "cloud-cli",
        label: "Cloud CLI Configuration",
        category: "config",
        files: [
          collectorFile(
            "/Users/e2e-tester/.aws/config",
            '[default]\nregion=us-east-1\n[profile work]\nregion=us-west-2'
          ),
          collectorFile(
            "/Users/e2e-tester/.config/railway/config.json",
            '{"token":"[REDACTED]","project":"otter"}'
          ),
        ],
        lists: [
          { name: "default", meta: { type: "aws-profile" } },
          { name: "work", meta: { type: "aws-profile" } },
        ],
        errors: [],
        skipped: [],
        durationMs: 19,
      },
      {
        id: "macos-defaults",
        label: "macOS System Preferences",
        category: "environment",
        files: [
          collectorFile(
            "macos-defaults/com.apple.dock.plist",
            "<?xml version=\"1.0\"?><plist><dict><key>autohide</key><true/></dict></plist>"
          ),
        ],
        lists: [
          { name: "Raycast", meta: { type: "login-item" } },
          { name: "CleanShot X", meta: { type: "login-item" } },
        ],
        errors: [],
        skipped: [],
        durationMs: 45,
      },
      {
        id: "launch-agents",
        label: "Launch Agents & Daemons",
        category: "environment",
        files: [
          collectorFile(
            "crontab",
            'MAILTO="alerts@example.com"\n0 1 * * * /usr/local/bin/backup --token [REDACTED]'
          ),
        ],
        lists: [
          { name: "com.example.sync.plist", meta: { type: "user-agent" } },
        ],
        errors: [],
        skipped: [],
        durationMs: 14,
      },
    ],
  };
}

export function getRichSnapshotCounts(snapshot: Snapshot) {
  return snapshot.collectors.reduce(
    (
      acc: { collectorCount: number; fileCount: number; listCount: number },
      collector: CollectorResult
    ) => {
      acc.collectorCount += 1;
      acc.fileCount += collector.files.length;
      acc.listCount += collector.lists.length;
      return acc;
    },
    { collectorCount: 0, fileCount: 0, listCount: 0 }
  );
}
