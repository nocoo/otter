import { readdir } from "node:fs/promises";
import { BaseCollector } from "./base.js";
import type {
  CollectorCategory,
  CollectorResult,
  CollectedListItem,
} from "@otter/core";

/**
 * Collects a list of installed applications from the Applications directory.
 * List-only: no binary content is collected.
 */
export class ApplicationsCollector extends BaseCollector {
  constructor(
    homeDir: string,
    private readonly appsDir: string = "/Applications"
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
          .map((entry) => ({
            name: entry.name.replace(/\.app$/, ""),
          }));
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
