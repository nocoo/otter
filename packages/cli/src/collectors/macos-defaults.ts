import { exec } from "node:child_process";
import { promisify } from "node:util";
import { BaseCollector } from "./base.js";
import type {
  CollectorCategory,
  CollectorResult,
  CollectedFile,
} from "@otter/core";

const execAsync = promisify(exec);

const DOMAINS = [
  "com.apple.dock",
  "com.apple.finder",
  "com.apple.AppleMultitouchTrackpad",
  "com.apple.driver.AppleBluetoothMultitouch.trackpad",
  "NSGlobalDomain",
  "com.apple.symbolichotkeys",
  "com.apple.screencapture",
];

export class MacOSDefaultsCollector extends BaseCollector {
  readonly id = "macos-defaults";
  readonly label = "macOS System Preferences";
  readonly category: CollectorCategory = "environment";

  _execCommand = async (cmd: string): Promise<string> => {
    const { stdout } = await execAsync(cmd);
    return stdout;
  };

  async collect(): Promise<CollectorResult> {
    return this.timed(async (result) => {
      for (const domain of DOMAINS) {
        try {
          const content = await this._execCommand(`defaults export ${domain} -`);
          const file: CollectedFile = {
            path: `macos-defaults/${domain}.plist`,
            content,
            sizeBytes: Buffer.byteLength(content, "utf-8"),
          };
          result.files.push(file);
        } catch (err) {
          result.errors.push(
            `Failed to export defaults domain ${domain}: ${(err as Error).message}`
          );
        }
      }

      try {
        const output = await this._execCommand(
          "osascript -e 'tell application \"System Events\" to get the name of every login item'"
        );
        const items = output
          .split(",")
          .map((name) => name.trim())
          .filter((name) => name.length > 0)
          .map((name) => ({ name, meta: { type: "login-item" } }));
        result.lists.push(...items);
      } catch {
        // headless environments may fail; ignore
      }
    });
  }
}
