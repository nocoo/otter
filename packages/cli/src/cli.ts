import { defineCommand } from "citty";
import { consola } from "consola";
import pc from "picocolors";
import { homedir } from "node:os";
import { join } from "node:path";
import { createDefaultCollectors } from "./collectors/index.js";
import { executeScan } from "./commands/scan.js";
import { executeConfig } from "./commands/config.js";
import { ConfigManager } from "./config/manager.js";
import { uploadSnapshot } from "./uploader/webhook.js";
import { exportIcons } from "./utils/icons.js";

const configManager = new ConfigManager(
  join(homedir(), ".config", "otter")
);

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
  },
  async run({ args }) {
    // When --json is set, redirect all progress output to stderr
    // so that stdout contains only valid JSON
    if (args.json) {
      consola.options.stdout = process.stderr;
    }

    consola.start("Scanning your Mac environment...\n");

    const collectors = createDefaultCollectors(homedir(), {
      slim: args.slim,
    });
    const snapshot = await executeScan(collectors, {
      onProgress: (id, result) => {
        const fileCount = result.files.length;
        const listCount = result.lists.length;
        const errorCount = result.errors.length;
        const status = errorCount > 0 ? pc.yellow("⚠") : pc.green("✓");
        consola.log(
          `  ${status} ${pc.bold(result.label)}: ${fileCount} files, ${listCount} list items${
            errorCount > 0 ? `, ${pc.yellow(`${errorCount} errors`)}` : ""
          } ${pc.dim(`(${result.durationMs}ms)`)}`
        );
      },
    });

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
      consola.success(
        `\nScan complete: ${pc.bold(String(totalFiles))} files, ${pc.bold(String(totalLists))} list items from ${pc.bold(String(snapshot.collectors.length))} collectors`
      );
      consola.info(`Snapshot ID: ${pc.dim(snapshot.id)}`);
    }
  },
});

const backupCommand = defineCommand({
  meta: {
    name: "backup",
    description: "Scan, build snapshot, and upload to webhook",
  },
  args: {
    slim: {
      type: "boolean",
      description:
        "Exclude behavior data (history.jsonl, session summaries) for a smaller snapshot",
      default: false,
    },
  },
  async run({ args }) {
    const config = await configManager.load();
    if (!config.webhookUrl) {
      consola.error(
        "No webhook URL configured. Run " +
          pc.bold("otter config set webhookUrl <url>") +
          " first."
      );
      process.exitCode = 1;
      return;
    }

    consola.start("Scanning your Mac environment...\n");

    const collectors = createDefaultCollectors(homedir(), {
      slim: args.slim,
    });
    const snapshot = await executeScan(collectors, {
      onProgress: (_id, result) => {
        const status =
          result.errors.length > 0 ? pc.yellow("⚠") : pc.green("✓");
        consola.log(
          `  ${status} ${pc.bold(result.label)} ${pc.dim(`(${result.durationMs}ms)`)}`
        );
      },
    });

    consola.start("\nUploading snapshot...");
    const uploadResult = await uploadSnapshot(snapshot, {
      webhookUrl: config.webhookUrl,
    });

    if (uploadResult.success) {
      consola.success(
        `Backup uploaded successfully ${pc.dim(`(${uploadResult.durationMs}ms)`)}`
      );
      consola.info(`Snapshot ID: ${pc.dim(snapshot.id)}`);
    } else {
      consola.error(`Upload failed: ${uploadResult.error}`);
      process.exitCode = 1;
    }
  },
});

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
      description: "Config key (e.g., webhookUrl)",
      required: false,
    },
    value: {
      type: "positional",
      description: "Value to set",
      required: false,
    },
  },
  async run({ args }) {
    const action = (args.action as string) || "show";

    if (action === "show") {
      const result = await executeConfig(configManager, { action: "show" });
      consola.info("Current configuration:");
      consola.log(JSON.stringify(result, null, 2));
      consola.log(pc.dim(`\nConfig file: ${configManager.configPath}`));
      return;
    }

    if (action === "get") {
      if (!args.key) {
        consola.error("Usage: otter config get <key>");
        process.exitCode = 1;
        return;
      }
      const result = await executeConfig(configManager, {
        action: "get",
        key: args.key as "webhookUrl",
      });
      if (result !== undefined) {
        consola.log(result as string);
      } else {
        consola.warn(`Key '${args.key}' is not set`);
      }
      return;
    }

    if (action === "set") {
      if (!args.key || !args.value) {
        consola.error("Usage: otter config set <key> <value>");
        process.exitCode = 1;
        return;
      }
      await executeConfig(configManager, {
        action: "set",
        key: args.key as "webhookUrl",
        value: args.value as string,
      });
      consola.success(`Set ${pc.bold(args.key as string)} = ${args.value}`);
      return;
    }

    consola.error(`Unknown action: ${action}. Use get, set, or show.`);
    process.exitCode = 1;
  },
});

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

    consola.start(`Exporting app icons to ${pc.bold(outputDir)}...\n`);

    const results = await exportIcons({
      outputDir,
      size,
      onProgress: (result) => {
        if (result.success) {
          consola.log(`  ${pc.green("✓")} ${result.appName}`);
        } else {
          consola.log(
            `  ${pc.yellow("⚠")} ${result.appName}: ${pc.dim(result.error ?? "unknown error")}`
          );
        }
      },
    });

    const succeeded = results.filter((r) => r.success).length;
    const failed = results.filter((r) => !r.success).length;
    consola.success(
      `\nExported ${pc.bold(String(succeeded))} icons` +
        (failed > 0 ? ` (${pc.yellow(String(failed))} skipped)` : "")
    );
    consola.info(`Output: ${pc.dim(outputDir)}`);
  },
});

export const main = defineCommand({
  meta: {
    name: "otter",
    version: "0.1.0",
    description:
      "Backup and restore your Mac development environment configuration",
  },
  subCommands: {
    scan: scanCommand,
    backup: backupCommand,
    config: configCommand,
    "export-icons": exportIconsCommand,
  },
});
