import { join } from "node:path";
import { readdir } from "node:fs/promises";
import { BaseCollector } from "./base.js";
import type {
  CollectorCategory,
  CollectorResult,
  CollectedListItem,
} from "@otter/core";

/** Directories that contain skills (list-only, not full content) */
const SKILLS_DIRS = [
  { relative: ".config/opencode/skills", source: ".config/opencode/skills" },
  { relative: ".agents/skills", source: ".agents/skills" },
];

/**
 * Collects OpenCode configuration files:
 * - ~/.config/opencode/ config files (excluding skills content)
 * - Skill names from ~/.config/opencode/skills/ and ~/.agents/skills/
 */
export class OpenCodeConfigCollector extends BaseCollector {
  readonly id = "opencode-config";
  readonly label = "OpenCode Configuration";
  readonly category: CollectorCategory = "config";

  async collect(): Promise<CollectorResult> {
    return this.timed(async (result) => {
      // 1. Collect config files from ~/.config/opencode/ (excluding skills dir)
      const configDir = join(this.homeDir, ".config", "opencode");
      const files = await this.collectDir(configDir, result, {
        filter: (path) => !path.includes("/skills/"),
      });
      result.files.push(...files);

      // 2. Collect skill names as list items
      for (const skillDir of SKILLS_DIRS) {
        const skills = await this.collectSkillNames(
          join(this.homeDir, skillDir.relative),
          skillDir.source,
          result
        );
        result.lists.push(...skills);
      }
    });
  }

  private async collectSkillNames(
    dirPath: string,
    source: string,
    result: CollectorResult
  ): Promise<CollectedListItem[]> {
    const items: CollectedListItem[] = [];
    try {
      const entries = await readdir(dirPath, { withFileTypes: true });
      for (const entry of entries) {
        if (entry.isDirectory()) {
          items.push({
            name: entry.name,
            meta: { source },
          });
        }
      }
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== "ENOENT") {
        result.errors.push(
          `Failed to read skills directory ${dirPath}: ${(err as Error).message}`
        );
      }
    }
    return items;
  }
}
