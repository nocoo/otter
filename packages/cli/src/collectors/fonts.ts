import { readdir } from "node:fs/promises";
import { extname, join } from "node:path";
import { BaseCollector } from "./base.js";
import type {
  CollectorCategory,
  CollectorResult,
  CollectedListItem,
} from "@otter/core";

export class FontsCollector extends BaseCollector {
  readonly id = "fonts";
  readonly label = "Installed Fonts";
  readonly category: CollectorCategory = "environment";

  async collect(): Promise<CollectorResult> {
    return this.timed(async (result) => {
      const fontsDir = join(this.homeDir, "Library", "Fonts");
      try {
        const entries = await readdir(fontsDir, { withFileTypes: true });
        const items: CollectedListItem[] = entries
          .filter((entry) => entry.isFile())
          .map((entry) => {
            const ext = extname(entry.name);
            return {
              name: entry.name.slice(0, ext ? -ext.length : undefined),
              meta: {
                type: "font",
                format: ext.replace(/^\./, "").toLowerCase() || "unknown",
              },
            };
          })
          .sort((a, b) => a.name.localeCompare(b.name));

        result.lists.push(...items);
      } catch (err) {
        if ((err as NodeJS.ErrnoException).code !== "ENOENT") {
          result.errors.push(
            `Failed to read fonts directory: ${(err as Error).message}`
          );
        }
      }
    });
  }
}
