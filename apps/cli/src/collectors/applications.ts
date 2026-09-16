import { exec } from "node:child_process";
import { createHash } from "node:crypto";
import { readdir } from "node:fs/promises";
import { join } from "node:path";
import { promisify } from "node:util";
import type { CollectedListItem, CollectorCategory, CollectorResult } from "@otter/core";
import { BaseCollector } from "./base.js";

const execAsync = promisify(exec);

const DOT_APP_SUFFIX = /\.app$/;

/** Generate a deterministic icon URL from an app name and base URL */
function iconUrl(appName: string, baseUrl: string): string {
  const hash = createHash("sha256").update(appName).digest("hex").slice(0, 12);
  return `${baseUrl}/${hash}.png`;
}

/**
 * Collects a list of installed applications from the Applications directory.
 * List-only: no binary content is collected.
 *
 * When `iconBaseUrl` is provided, each item includes `meta.iconUrl` pointing
 * to a deterministic R2 URL (SHA-256 hash of app name).
 */
export class ApplicationsCollector extends BaseCollector {
  private readonly userAppsDir: string;

  constructor(
    homeDir: string,
    private readonly systemAppsDir: string = "/Applications",
    private readonly iconBaseUrl?: string,
    userAppsDir?: string,
  ) {
    super(homeDir);
    this.userAppsDir = userAppsDir ?? join(homeDir, "Applications");
  }

  /** Overridable for testing — executes a shell command and returns stdout */
  _execCommand = async (cmd: string): Promise<string> => {
    const { stdout } = await execAsync(cmd);
    return stdout;
  };

  readonly id = "applications";
  readonly label = "Installed Applications";
  readonly category: CollectorCategory = "environment";

  collect(): Promise<CollectorResult> {
    return this.timed(async (result) => {
      const apps = new Map<string, CollectedListItem>();

      await this.collectFromDir(this.systemAppsDir, apps, result);
      await this.collectFromDir(this.userAppsDir, apps, result);

      result.lists.push(...Array.from(apps.values()).sort((a, b) => a.name.localeCompare(b.name)));
    });
  }

  private async collectFromDir(
    appsDir: string,
    apps: Map<string, CollectedListItem>,
    result: CollectorResult,
  ): Promise<void> {
    try {
      const entries = await readdir(appsDir, { withFileTypes: true });
      for (const entry of entries) {
        if (!entry.isDirectory() || !entry.name.endsWith(".app")) continue;

        const name = entry.name.replace(DOT_APP_SUFFIX, "");
        const existing = apps.get(name);
        if (existing) continue;

        // biome-ignore lint/performance/noAwaitInLoops: sequential directory entry processing with deduplication
        const version = await this.getAppVersion(appsDir, entry.name);
        const item: CollectedListItem = {
          name,
          ...(version ? { version } : {}),
        };
        if (this.iconBaseUrl) {
          item.meta = { iconUrl: iconUrl(name, this.iconBaseUrl) };
        }
        apps.set(name, item);
      }
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== "ENOENT") {
        result.errors.push(
          `Failed to read applications directory ${appsDir}: ${(err as Error).message}`,
        );
      }
    }
  }

  private async getAppVersion(appsDir: string, entryName: string): Promise<string | undefined> {
    const plistPath = join(appsDir, entryName, "Contents", "Info.plist");
    try {
      const version = await this._execCommand(
        `defaults read ${JSON.stringify(plistPath)} CFBundleShortVersionString`,
      );
      const trimmed = version.trim();
      return trimmed.length > 0 ? trimmed : undefined;
    } catch {
      return undefined;
    }
  }
}
