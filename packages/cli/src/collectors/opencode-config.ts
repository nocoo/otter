import { join } from "node:path";
import { readdir, readFile } from "node:fs/promises";
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
 * Parse YAML-like frontmatter from a SKILL.md file.
 * Extracts simple `key: value` pairs between `---` delimiters.
 * Exported for testing.
 */
export function parseSkillFrontmatter(
  content: string
): Record<string, string> {
  const meta: Record<string, string> = {};
  const match = content.match(/^---\s*\n([\s\S]*?)\n---/);
  if (!match) return meta;

  for (const line of match[1].split("\n")) {
    // Match simple key: value (not nested YAML)
    const kv = line.match(/^(\w[\w-]*)\s*:\s*(.+)$/);
    if (kv) {
      meta[kv[1].trim()] = kv[2].trim();
    }
  }
  return meta;
}

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
        redact: true,
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
        if (!entry.isDirectory()) continue;

        const meta: Record<string, string> = { source };
        const location = `file://${join(dirPath, entry.name, "SKILL.md")}`;
        meta.location = location;

        // Try to parse SKILL.md frontmatter for description
        try {
          const skillMd = await readFile(
            join(dirPath, entry.name, "SKILL.md"),
            "utf-8"
          );
          const fm = parseSkillFrontmatter(skillMd);
          if (fm.description) {
            meta.description = fm.description;
          }
          if (fm.name) {
            meta.skillName = fm.name;
          }
        } catch {
          // SKILL.md missing or unreadable — not an error, just skip enrichment
        }

        items.push({ name: entry.name, meta });
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
