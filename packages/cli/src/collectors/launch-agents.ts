import { exec } from "node:child_process";
import { readdir } from "node:fs/promises";
import { join } from "node:path";
import { promisify } from "node:util";
import { BaseCollector } from "./base.js";
import type {
  CollectorCategory,
  CollectorResult,
  CollectedFile,
} from "@otter/core";
import { redactSecrets } from "../utils/redact.js";

const execAsync = promisify(exec);

export class LaunchAgentsCollector extends BaseCollector {
  readonly id = "launch-agents";
  readonly label = "Launch Agents & Daemons";
  readonly category: CollectorCategory = "environment";

  _execCommand = async (cmd: string): Promise<string> => {
    const { stdout } = await execAsync(cmd);
    return stdout;
  };

  async collect(): Promise<CollectorResult> {
    return this.timed(async (result) => {
      const agentsDir = join(this.homeDir, "Library", "LaunchAgents");
      try {
        const entries = await readdir(agentsDir, { withFileTypes: true });
        result.lists.push(
          ...entries
            .filter((entry) => entry.isFile() && entry.name.endsWith(".plist"))
            .map((entry) => ({
              name: entry.name,
              meta: { type: "user-agent" },
            }))
            .sort((a, b) => a.name.localeCompare(b.name))
        );
      } catch (err) {
        if ((err as NodeJS.ErrnoException).code !== "ENOENT") {
          result.errors.push(
            `Failed to read launch agents: ${(err as Error).message}`
          );
        }
      }

      try {
        const output = await this._execCommand("crontab -l");
        const trimmed = output.trim();
        if (trimmed.length > 0) {
          const content = redactSecrets(trimmed, ".env");
          const file: CollectedFile = {
            path: "crontab",
            content,
            sizeBytes: Buffer.byteLength(content, "utf-8"),
          };
          result.files.push(file);
        }
      } catch {
        // no crontab configured is fine
      }
    });
  }
}
