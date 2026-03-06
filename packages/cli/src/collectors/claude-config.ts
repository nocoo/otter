import { join } from "node:path";
import { BaseCollector } from "./base.js";
import type { CollectorCategory, CollectorResult } from "@otter/core";

/** Files/patterns to exclude from .claude directory for security */
const EXCLUDED_PATTERNS = [
  "credentials.json",
  "*.key",
  "*.pem",
  "*.token",
];

function isExcluded(filePath: string): boolean {
  const name = filePath.split("/").pop() ?? "";
  return EXCLUDED_PATTERNS.some((pattern) => {
    if (pattern.startsWith("*")) {
      return name.endsWith(pattern.slice(1));
    }
    return name === pattern;
  });
}

/**
 * Collects Claude Code configuration files:
 * - ~/CLAUDE.md
 * - ~/.claude/ directory (excluding credentials)
 */
export class ClaudeConfigCollector extends BaseCollector {
  readonly id = "claude-config";
  readonly label = "Claude Code Configuration";
  readonly category: CollectorCategory = "config";

  async collect(): Promise<CollectorResult> {
    return this.timed(async (result) => {
      // 1. Collect ~/CLAUDE.md
      const claudeMd = await this.safeReadFile(
        join(this.homeDir, "CLAUDE.md"),
        result
      );
      if (claudeMd) result.files.push(claudeMd);

      // 2. Collect ~/.claude/ directory (excluding sensitive files)
      const claudeDir = join(this.homeDir, ".claude");
      const files = await this.collectDir(claudeDir, result, {
        filter: (path) => !isExcluded(path),
      });
      result.files.push(...files);
    });
  }
}
