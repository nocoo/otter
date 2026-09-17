import { exec } from "node:child_process";
import { createHash } from "node:crypto";
import { access, readdir, realpath } from "node:fs/promises";
import { join } from "node:path";
import { promisify } from "node:util";
import type { CollectedListItem, CollectorCategory, CollectorResult } from "@otter/core";
import { BaseCollector } from "./base.js";

const execAsync = promisify(exec);

const BUNDLE_ID = /[a-z].*\./i;

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
      if (this.systemAppsDir === "/Applications")
        await this.collectFromDir("/System/Applications", apps, result);

      result.lists.push(...Array.from(apps.values()).sort((a, b) => a.name.localeCompare(b.name)));
    });
  }

  private async collectFromDir(
    appsDir: string,
    apps: Map<string, CollectedListItem>,
    result: CollectorResult,
    depth = 0,
  ): Promise<void> {
    const entries = await readdir(appsDir, { withFileTypes: true }).catch(
      (err: NodeJS.ErrnoException) => {
        if (err.code !== "ENOENT")
          result.errors.push(`Failed to read applications directory ${appsDir}: ${err.message}`);
        return [];
      },
    );
    for (const entry of entries) {
      const path = join(appsDir, entry.name);
      if (!entry.name.endsWith(".app")) {
        if (entry.isDirectory() && depth < 3) {
          // biome-ignore lint/performance/noAwaitInLoops: bounded depth-first traversal avoids spawning plist processes for an entire tree
          await this.collectFromDir(path, apps, result, depth + 1);
        }
        continue;
      }
      if ((!entry.isDirectory() && !entry.isSymbolicLink()) || apps.has(path)) continue;
      const item = await this.applicationItem(appsDir, entry.name, result);
      if (item) apps.set(path, item);
    }
  }

  private async applicationItem(
    appsDir: string,
    entryName: string,
    result: CollectorResult,
  ): Promise<CollectedListItem | undefined> {
    const name = entryName.slice(0, -4),
      path = join(appsDir, entryName);
    try {
      const [version, bundleId, physical, storeReceipt] = await Promise.all([
        this.getAppVersion(appsDir, entryName),
        this.getAppVersion(appsDir, entryName, "CFBundleIdentifier"),
        realpath(path),
        access(join(path, "Contents/_MASReceipt/receipt")).then(
          () => true,
          () => false,
        ),
      ]);
      const installSource = storeReceipt
        ? "Mac App Store"
        : physical.includes("/Caskroom/")
          ? "Homebrew"
          : path.startsWith("/System/")
            ? "macOS"
            : "unknown";
      return {
        name,
        ...(version ? { version } : {}),
        meta: {
          path,
          source: path,
          installSource,
          ...(bundleId && BUNDLE_ID.test(bundleId) ? { bundleId } : {}),
          ...(this.iconBaseUrl ? { iconUrl: iconUrl(name, this.iconBaseUrl) } : {}),
        },
      };
    } catch (error) {
      result.errors.push(`Failed to inspect application ${path}: ${(error as Error).message}`);
      return undefined;
    }
  }

  private async getAppVersion(
    appsDir: string,
    entryName: string,
    field = "CFBundleShortVersionString",
  ): Promise<string | undefined> {
    const plistPath = join(appsDir, entryName, "Contents", "Info.plist");
    try {
      const version = await this._execCommand(
        `defaults read '${plistPath.replaceAll("'", "'\\''")}' ${field}`,
      );
      const trimmed = version.trim();
      return trimmed.length > 0 ? trimmed : undefined;
    } catch {
      return undefined;
    }
  }
}
