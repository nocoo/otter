import { join } from "node:path";
import { readFile, readdir } from "node:fs/promises";
import { BaseCollector } from "./base.js";
import type {
  CollectorCategory,
  CollectorResult,
  CollectedFile,
} from "@otter/core";

// ---------------------------------------------------------------------------
// Session metadata types (for snapshot summary, not full conversation content)
// ---------------------------------------------------------------------------

interface SessionEntry {
  sessionId: string;
  firstPrompt?: string;
  messageCount?: number;
  created?: string;
  modified?: string;
  gitBranch?: string;
  projectPath?: string;
  isSidechain?: boolean;
}

interface SessionIndex {
  version?: number;
  entries: SessionEntry[];
  originalPath?: string;
}

interface ProjectSummary {
  projectPath: string;
  sessions: SessionEntry[];
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Files to collect as full content (small, valuable config files) */
const TARGETED_FILES = [
  "CLAUDE.md", // user-level instructions
  "settings.json", // settings (will need credential redaction in Phase 3)
  "stats-cache.json", // aggregate usage stats
  "plugins/installed_plugins.json", // plugin inventory
  "plugins/blocklist.json", // plugin blocklist
  "history.jsonl", // prompt history
];

/**
 * Collects Claude Code configuration files with targeted, safe collection.
 *
 * What we collect:
 *  - ~/CLAUDE.md (user-level instructions)
 *  - ~/.claude/CLAUDE.md, settings.json, stats-cache.json
 *  - ~/.claude/plugins/installed_plugins.json, plugins/blocklist.json
 *  - ~/.claude/history.jsonl
 *  - Conversation metadata summaries (title, timestamps, token counts)
 *    from projects/sessions-index.json files — NOT full conversation content
 *
 * What we skip:
 *  - debug/, telemetry/, transcripts/, cache/, paste-cache/
 *  - shell-snapshots/, session-env/, statsig/
 *  - All .jsonl session content files
 *  - .git/ directories inside plugins
 *  - Binary files, large files
 */
export class ClaudeConfigCollector extends BaseCollector {
  readonly id = "claude-config";
  readonly label = "Claude Code Configuration";
  readonly category: CollectorCategory = "config";

  async collect(): Promise<CollectorResult> {
    return this.timed(async (result) => {
      const claudeDir = join(this.homeDir, ".claude");

      // 1. Collect ~/CLAUDE.md (home-level instructions)
      const homeMd = await this.safeReadFile(
        join(this.homeDir, "CLAUDE.md"),
        result
      );
      if (homeMd) result.files.push(homeMd);

      // 2. Collect targeted config files from ~/.claude/
      for (const relativePath of TARGETED_FILES) {
        const file = await this.safeReadFile(
          join(claudeDir, relativePath),
          result
        );
        if (file) result.files.push(file);
      }

      // 3. Collect conversation metadata summaries (not full content)
      const summaryFile = await this.collectSessionSummaries(
        claudeDir,
        result
      );
      if (summaryFile) result.files.push(summaryFile);
    });
  }

  /**
   * Iterate over all projects/sessions-index.json files and extract
   * lightweight metadata for each conversation session.
   *
   * Returns a synthetic CollectedFile containing JSON with all project
   * summaries — no actual conversation content is included.
   */
  private async collectSessionSummaries(
    claudeDir: string,
    result: CollectorResult
  ): Promise<CollectedFile | null> {
    const projectsDir = join(claudeDir, "projects");
    const summaries: ProjectSummary[] = [];

    try {
      // Each subdirectory under projects/ is a hashed project path
      const projectDirs = await readdir(projectsDir, { withFileTypes: true });

      for (const entry of projectDirs) {
        if (!entry.isDirectory()) continue;

        const indexPath = join(
          projectsDir,
          entry.name,
          "sessions-index.json"
        );

        try {
          const raw = await readFile(indexPath, "utf-8");
          const index: SessionIndex = JSON.parse(raw);

          if (!index.entries?.length) continue;

          summaries.push({
            projectPath: index.originalPath ?? entry.name,
            sessions: index.entries.map((e) => ({
              sessionId: e.sessionId,
              firstPrompt: e.firstPrompt,
              messageCount: e.messageCount,
              created: e.created,
              modified: e.modified,
              gitBranch: e.gitBranch,
              projectPath: e.projectPath,
              isSidechain: e.isSidechain,
            })),
          });
        } catch {
          // sessions-index.json missing or malformed — skip silently
        }
      }
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== "ENOENT") {
        result.errors.push(
          `Failed to read Claude projects directory: ${(err as Error).message}`
        );
      }
      return null;
    }

    if (summaries.length === 0) return null;

    const content = JSON.stringify(summaries, null, 2);
    return {
      path: join(claudeDir, "projects", "__sessions-summary.json"),
      content,
      sizeBytes: Buffer.byteLength(content, "utf-8"),
    };
  }
}
