import { createHash } from "node:crypto";
import { readdir } from "node:fs/promises";
import { BaseCollector } from "./base.js";
import type {
  CollectorCategory,
  CollectorResult,
  CollectedListItem,
} from "@otter/core";

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
  constructor(
    homeDir: string,
    private readonly appsDir: string = "/Applications",
    private readonly iconBaseUrl?: string,
  ) {
    super(homeDir);
  }

  readonly id = "applications";
  readonly label = "Installed Applications";
  readonly category: CollectorCategory = "environment";

  async collect(): Promise<CollectorResult> {
    return this.timed(async (result) => {
      try {
        const entries = await readdir(this.appsDir, { withFileTypes: true });
        const apps: CollectedListItem[] = entries
          .filter(
            (entry) => entry.isDirectory() && entry.name.endsWith(".app")
          )
          .map((entry) => {
            const name = entry.name.replace(/\.app$/, "");
            const item: CollectedListItem = { name };
            if (this.iconBaseUrl) {
              item.meta = { iconUrl: iconUrl(name, this.iconBaseUrl) };
            }
            return item;
          });
        result.lists.push(...apps);
      } catch (err) {
        if ((err as NodeJS.ErrnoException).code !== "ENOENT") {
          result.errors.push(
            `Failed to read applications directory: ${(err as Error).message}`
          );
        }
      }
    });
  }
}
