import { defineCommand } from "citty";
import { homedir } from "node:os";
import { join } from "node:path";
import yoctoSpinner from "yocto-spinner";
import { createDefaultCollectors } from "./collectors/index.js";
import { executeScan } from "./commands/scan.js";
import { executeConfig } from "./commands/config.js";
import {
  executeLogin,
  resolveHost,
  buildWebhookUrl,
} from "./commands/login.js";
import {
  formatSnapshotList,
  formatSnapshotDetail,
  diffSnapshots,
  formatSnapshotDiff,
} from "./commands/snapshot.js";
import { ConfigManager } from "./config/manager.js";
import { SnapshotStore } from "./storage/local.js";
import { uploadSnapshot } from "./uploader/webhook.js";
import { uploadIconsToServer } from "./uploader/icons-server.js";
import { exportIcons } from "./utils/icons.js";
import * as ui from "./ui.js";

const CLI_VERSION = "1.2.0";

const otterConfigDir = join(homedir(), ".config", "otter");
const snapshotStore = new SnapshotStore(join(otterConfigDir, "snapshots"));

/**
 * Detect whether --dev is set from process.argv.
 * citty doesn't provide a global args mechanism, so we parse manually.
 */
function isDevMode(): boolean {
  return process.argv.includes("--dev");
}

/** Lazily create ConfigManager based on dev flag. */
function getConfigManager(): ConfigManager {
  return new ConfigManager(otterConfigDir, isDevMode());
}

// ── scan ────────────────────────────────────────────────────────────

const scanCommand = defineCommand({
  meta: {
    name: "scan",
    description: "Scan and collect configuration files and environment data",
  },
  args: {
    json: {
      type: "boolean",
      description: "Output snapshot as JSON to stdout",
      default: false,
    },
    slim: {
      type: "boolean",
      description:
        "Exclude behavior data (history.jsonl, session summaries) for a smaller snapshot",
      default: false,
    },
    save: {
      type: "boolean",
      description: "Save the snapshot locally after scanning",
      default: false,
    },
  },
  async run({ args }) {
    // When --json is set, redirect all progress output to stderr
    // so that stdout contains only valid JSON
    if (args.json) {
      ui.consola.options.stdout = process.stderr;
    }

    ui.banner(CLI_VERSION);
    console.log("Scanning environment...\n");

    const collectors = createDefaultCollectors(homedir(), {
      slim: args.slim,
    });
    let scanSpinner: ReturnType<typeof yoctoSpinner> | null = null;
    const useSpinner = !args.json;
    const snapshot = await executeScan(collectors, {
      onStart: (_id, label) => {
        if (useSpinner) {
          scanSpinner = yoctoSpinner({
            text: `Scanning ${label}...`,
            stream: process.stdout,
          }).start();
        }
      },
      onProgress: (_id, result) => {
        scanSpinner?.stop();
        scanSpinner = null;
        ui.item({
          label: result.label,
          fileCount: result.files.length,
          listCount: result.lists.length,
          errorCount: result.errors.length,
          skippedCount: result.skipped?.length ?? 0,
          durationMs: result.durationMs,
        });
      },
    });

    if (args.save) {
      const filename = await snapshotStore.save(snapshot);
      ui.statusLine(ui.S.success, `Saved locally: ${ui.pc.dim(filename)}`);
    }

    if (args.json) {
      process.stdout.write(JSON.stringify(snapshot, null, 2) + "\n");
    } else {
      const totalFiles = snapshot.collectors.reduce(
        (sum, c) => sum + c.files.length,
        0
      );
      const totalLists = snapshot.collectors.reduce(
        (sum, c) => sum + c.lists.length,
        0
      );

      ui.blank();
      ui.box({
        title: "Scan complete",
        lines: [
          `${totalFiles} files \u00b7 ${totalLists} items \u00b7 ${snapshot.collectors.length} collectors`,
          ui.pc.dim(`Snapshot: ${snapshot.id.slice(0, 8)}`),
        ],
      });
    }
  },
});

// ── backup ──────────────────────────────────────────────────────────

const backupCommand = defineCommand({
  meta: {
    name: "backup",
    description: "Scan, build snapshot, and upload to webhook",
  },
  args: {
    dev: {
      type: "boolean",
      description: "Use the dev host (otter.dev.hexly.ai)",
      default: false,
    },
    slim: {
      type: "boolean",
      description:
        "Exclude behavior data (history.jsonl, session summaries) for a smaller snapshot",
      default: false,
    },
  },
  async run({ args }) {
    const configManager = getConfigManager();
    const config = await configManager.load();
    if (!config.token) {
      ui.banner(CLI_VERSION);
      ui.error(
        `Not logged in. Run ${ui.pc.bold("otter login")} first.`
      );
      process.exitCode = 1;
      return;
    }

    const host = resolveHost({ dev: args.dev });
    const webhookUrl = buildWebhookUrl(host, config.token);

    ui.banner(CLI_VERSION);

    // ── Step 1: Scan ──
    ui.step("Scanning environment", 1, 3);
    ui.blank();

    const collectors = createDefaultCollectors(homedir(), {
      slim: args.slim,
    });
    let backupSpinner: ReturnType<typeof yoctoSpinner> | null = null;
    const snapshot = await executeScan(collectors, {
      onStart: (_id, label) => {
        backupSpinner = yoctoSpinner({
          text: `Scanning ${label}...`,
          stream: process.stdout,
        }).start();
      },
      onProgress: (_id, result) => {
        backupSpinner?.stop();
        backupSpinner = null;
        ui.item({
          label: result.label,
          fileCount: result.files.length,
          listCount: result.lists.length,
          errorCount: result.errors.length,
          skippedCount: result.skipped?.length ?? 0,
          durationMs: result.durationMs,
        });
      },
    });

    ui.blank();

    // ── Step 2: Upload snapshot ──
    ui.step("Uploading snapshot", 2, 3);

    const spinner = yoctoSpinner({ text: "Uploading..." }).start();
    const uploadResult = await uploadSnapshot(snapshot, { webhookUrl });

    if (!uploadResult.success) {
      spinner.error(`Upload failed: ${uploadResult.error}`);
      process.exitCode = 1;
      return;
    }

    spinner.success("Uploaded");

    // Auto-save locally after successful upload
    const filename = await snapshotStore.save(snapshot);
    ui.statusLine(ui.S.success, `Saved locally`, 0);

    ui.blank();

    // ── Step 3: Icons ──
    ui.step("Uploading icons", 3, 3);

    const iconDir = join(otterConfigDir, "icons");
    const iconResults = await exportIcons({ outputDir: iconDir, size: 128 });
    const exported = iconResults.filter((r) => r.success && r.outputPath);

    if (exported.length > 0) {
      ui.statusLine(
        ui.S.success,
        `${exported.length} icons exported`
      );

      const iconsUrl = `${webhookUrl}/icons`;
      const icons = exported.map((r) => ({
        appName: r.appName,
        pngPath: r.outputPath!,
      }));

      const iconSpinner = yoctoSpinner({ text: "Uploading icons..." }).start();
      const iconUpload = await uploadIconsToServer(icons, { iconsUrl });

      if (iconUpload.success) {
        iconSpinner.success(
          `${iconUpload.stored} icons uploaded`
        );
      } else {
        iconSpinner.warning(
          `Icon upload issue: ${iconUpload.error ?? "partial failure"}` +
            (iconUpload.stored > 0
              ? ` (${iconUpload.stored}/${iconUpload.total} stored)`
              : "")
        );
      }
    } else {
      ui.statusLine(ui.S.info, "No app icons found to upload");
    }

    // ── Summary ──
    const totalFiles = snapshot.collectors.reduce(
      (sum, c) => sum + c.files.length,
      0
    );
    const totalLists = snapshot.collectors.reduce(
      (sum, c) => sum + c.lists.length,
      0
    );

    ui.blank();
    ui.box({
      title: "Backup complete",
      lines: [
        `${totalFiles} files \u00b7 ${totalLists} items \u00b7 ${snapshot.collectors.length} collectors`,
        ...(exported.length > 0 ? [`${exported.length} icons uploaded`] : []),
        "",
        ui.pc.dim(`Snapshot: ${snapshot.id.slice(0, 8)}`),
      ],
    });
  },
});

// ── config ──────────────────────────────────────────────────────────

const configCommand = defineCommand({
  meta: {
    name: "config",
    description: "Manage CLI configuration",
  },
  args: {
    action: {
      type: "positional",
      description: "Action: get, set, or show",
      required: false,
    },
    key: {
      type: "positional",
      description: "Config key (e.g., token)",
      required: false,
    },
    value: {
      type: "positional",
      description: "Value to set",
      required: false,
    },
  },
  async run({ args }) {
    const configManager = getConfigManager();
    const action = (args.action as string) || "show";

    if (action === "show") {
      const result = await executeConfig(configManager, { action: "show" });
      const entries = Object.entries(result as Record<string, unknown>);
      const lines = entries.map(
        ([k, v]) => `${ui.pc.bold(k)}: ${ui.pc.dim(String(v))}`
      );
      lines.push("", ui.pc.dim(`Config file: ${configManager.configPath}`));
      ui.consola.box({
        title: "Configuration",
        message: lines.join("\n"),
        style: { marginLeft: 0 },
      });
      return;
    }

    if (action === "get") {
      if (!args.key) {
        ui.error("Usage: otter config get <key>");
        process.exitCode = 1;
        return;
      }
      const result = await executeConfig(configManager, {
        action: "get",
        key: args.key as "token",
      });
      if (result !== undefined) {
        console.log(result as string);
      } else {
        ui.warn(`Key '${args.key}' is not set`);
      }
      return;
    }

    if (action === "set") {
      if (!args.key || !args.value) {
        ui.error("Usage: otter config set <key> <value>");
        process.exitCode = 1;
        return;
      }
      await executeConfig(configManager, {
        action: "set",
        key: args.key as "token",
        value: args.value as string,
      });
      ui.success(`Set ${ui.pc.bold(args.key as string)} = ${args.value}`);
      return;
    }

    ui.error(`Unknown action: ${action}. Use get, set, or show.`);
    process.exitCode = 1;
  },
});

// ── snapshot ────────────────────────────────────────────────────────

const snapshotListCommand = defineCommand({
  meta: {
    name: "list",
    description: "List locally-saved snapshots",
  },
  async run() {
    const metas = await snapshotStore.list();
    console.log(formatSnapshotList(metas));
  },
});

const snapshotShowCommand = defineCommand({
  meta: {
    name: "show",
    description: "Show details of a saved snapshot",
  },
  args: {
    id: {
      type: "positional",
      description: "Short ID (first 8 chars) or full UUID of the snapshot",
      required: true,
    },
  },
  async run({ args }) {
    const snapshot = await snapshotStore.load(args.id as string);
    if (!snapshot) {
      ui.error(`Snapshot not found: ${ui.pc.bold(args.id as string)}`);
      process.exitCode = 1;
      return;
    }
    console.log(formatSnapshotDetail(snapshot));
  },
});

const snapshotDiffCommand = defineCommand({
  meta: {
    name: "diff",
    description: "Compare two snapshots (file + list level)",
  },
  args: {
    id1: {
      type: "positional",
      description: "Short ID of the older snapshot",
      required: true,
    },
    id2: {
      type: "positional",
      description: "Short ID of the newer snapshot",
      required: true,
    },
  },
  async run({ args }) {
    const oldSnap = await snapshotStore.load(args.id1 as string);
    if (!oldSnap) {
      ui.error(`Snapshot not found: ${ui.pc.bold(args.id1 as string)}`);
      process.exitCode = 1;
      return;
    }
    const newSnap = await snapshotStore.load(args.id2 as string);
    if (!newSnap) {
      ui.error(`Snapshot not found: ${ui.pc.bold(args.id2 as string)}`);
      process.exitCode = 1;
      return;
    }

    const diff = diffSnapshots(oldSnap, newSnap);
    console.log(formatSnapshotDiff(diff));
  },
});

const snapshotCommand = defineCommand({
  meta: {
    name: "snapshot",
    description: "Manage locally-saved snapshots",
  },
  subCommands: {
    list: snapshotListCommand,
    show: snapshotShowCommand,
    diff: snapshotDiffCommand,
  },
});

// ── export-icons ────────────────────────────────────────────────────

const exportIconsCommand = defineCommand({
  meta: {
    name: "export-icons",
    description: "Export application icons as PNG files",
  },
  args: {
    output: {
      type: "string",
      description: "Output directory for PNG icons",
      alias: "o",
      required: false,
    },
    size: {
      type: "string",
      description: "Icon size in pixels (default: 128)",
      alias: "s",
      required: false,
    },
  },
  async run({ args }) {
    const outputDir =
      (args.output as string) || join(homedir(), ".otter", "icons");
    const size = parseInt((args.size as string) || "128", 10);

    ui.banner(CLI_VERSION);
    console.log(`Exporting app icons to ${ui.pc.bold(outputDir)}...\n`);

    const results = await exportIcons({
      outputDir,
      size,
      onProgress: (result) => {
        if (result.success) {
          console.log(`${ui.S.success}  ${result.appName}`);
        } else {
          console.log(
            `${ui.S.warning}  ${result.appName}: ${ui.pc.dim(result.error ?? "unknown error")}`
          );
        }
      },
    });

    const succeeded = results.filter((r) => r.success).length;
    const failed = results.filter((r) => !r.success).length;

    ui.blank();
    ui.box({
      title: "Export complete",
      lines: [
        `${succeeded} icons exported` +
          (failed > 0 ? `  ${ui.pc.yellow(`${failed} skipped`)}` : ""),
        ui.pc.dim(`Output: ${outputDir}`),
      ],
    });
  },
});

// ── login ───────────────────────────────────────────────────────────

const loginCommand = defineCommand({
  meta: {
    name: "login",
    description:
      "Connect your CLI to the Otter dashboard via browser-based OAuth",
  },
  args: {
    dev: {
      type: "boolean",
      description: "Use the dev host (otter.dev.hexly.ai)",
      default: false,
    },
  },
  async run({ args }) {
    const configManager = getConfigManager();

    ui.banner(CLI_VERSION);

    const spinner = yoctoSpinner({ text: "Starting login flow..." }).start();

    const result = await executeLogin(
      configManager,
      { dev: args.dev },
      {
        onPortReady: (port) => {
          spinner.text = `Local server listening on port ${ui.pc.bold(String(port))}`;
        },
        onBrowserOpen: (url) => {
          spinner.text = `Waiting for browser connection...`;
          ui.info(`Opening browser: ${ui.pc.dim(url)}`);
          console.log(
            `${ui.pc.dim("Waiting for you to connect in the browser (30s timeout)...")}`
          );
        },
        onSuccess: (token) => {
          spinner.success("Connected! Token saved.");
          ui.blank();
          ui.info(`Token: ${ui.pc.dim(token.slice(0, 8))}...`);
          ui.info(
            `Run ${ui.pc.bold("otter backup")} to create your first backup.`
          );
        },
        onError: (err) => {
          spinner.error(`Login failed: ${err}`);
        },
        onTimeout: () => {
          spinner.warning("Login timed out (30s). Please try again.");
        },
      }
    );

    if (!result.success) {
      process.exitCode = 1;
    }
  },
});

// ── main ────────────────────────────────────────────────────────────

export const main = defineCommand({
  meta: {
    name: "otter",
    version: CLI_VERSION,
    description:
      "Backup and restore your Mac development environment configuration",
  },
  subCommands: {
    login: loginCommand,
    scan: scanCommand,
    backup: backupCommand,
    config: configCommand,
    snapshot: snapshotCommand,
    "export-icons": exportIconsCommand,
  },
});
