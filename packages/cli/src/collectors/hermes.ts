import { readdir } from "node:fs/promises";
import { join } from "node:path";
import type { CollectedListItem, CollectorCategory, CollectorResult } from "@otter/core";
import { BaseCollector } from "./base.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface HermesProfile {
  /** Display name: "default" for main profile, directory name for named profiles */
  name: string;
  /** "main" for ~/.hermes/, "named" for ~/.hermes/profiles/<name>/ */
  type: "main" | "named";
  /** Actual filesystem path to the profile root */
  dir: string;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Config files to collect from each Hermes profile */
const PROFILE_FILES: ReadonlyArray<{ relative: string; redact: boolean }> = [
  { relative: "config.yaml", redact: true },
  { relative: "SOUL.md", redact: false },
  { relative: "memories/MEMORY.md", redact: false },
  { relative: "memories/USER.md", redact: false },
  { relative: "cron/jobs.json", redact: true },
];

/**
 * Collects Hermes Agent profile configurations.
 *
 * What we collect:
 *  - config.yaml (redacted) — model, tool, and platform configuration
 *  - SOUL.md — agent persona definition
 *  - memories/MEMORY.md — agent persistent memory
 *  - memories/USER.md — user profile
 *  - cron/jobs.json (redacted) — scheduled task definitions
 *  - skills/ directory listing (names only, not content)
 *
 * What we skip:
 *  - .env (API keys)
 *  - sessions/ (conversation database, too large)
 *  - state.db (runtime SQLite state)
 *  - auth.json (OAuth tokens)
 */
export class HermesCollector extends BaseCollector {
  readonly id = "hermes";
  readonly label = "Hermes Agent Profiles";
  readonly category: CollectorCategory = "config";

  collect(): Promise<CollectorResult> {
    return this.timed(async (result) => {
      const hermesDir = join(this.homeDir, ".hermes");

      // 1. Discover all profiles (main + named)
      const profiles = await this.discoverProfiles(hermesDir);
      if (profiles.length === 0) {
        result.skipped.push("Hermes not installed (~/.hermes/ not found)");
        return;
      }

      // 2. Collect each profile independently
      for (const profile of profiles) {
        // biome-ignore lint/performance/noAwaitInLoops: sequential profile collection with error isolation
        await this.collectProfile(profile, result);
      }
    });
  }

  /**
   * Discover all Hermes profiles.
   * Returns empty array if ~/.hermes/ does not exist.
   */
  private async discoverProfiles(hermesDir: string): Promise<HermesProfile[]> {
    const profiles: HermesProfile[] = [];

    // Check if ~/.hermes/ exists at all
    try {
      await readdir(hermesDir);
    } catch {
      return [];
    }

    // Main profile is ~/.hermes/ itself
    profiles.push({
      name: "default",
      type: "main",
      dir: hermesDir,
    });

    // Named profiles under ~/.hermes/profiles/
    const profilesDir = join(hermesDir, "profiles");
    try {
      const entries = await readdir(profilesDir, { withFileTypes: true });
      for (const entry of entries) {
        if (entry.isDirectory()) {
          profiles.push({
            name: entry.name,
            type: "named",
            dir: join(profilesDir, entry.name),
          });
        }
      }
    } catch {
      // No profiles/ directory — only main profile exists
    }

    return profiles;
  }

  /**
   * Collect files and metadata from a single Hermes profile.
   */
  private async collectProfile(profile: HermesProfile, result: CollectorResult): Promise<void> {
    // Collect config files with virtual path prefix for identification
    for (const { relative, redact } of PROFILE_FILES) {
      const actualPath = join(profile.dir, relative);
      // biome-ignore lint/performance/noAwaitInLoops: small fixed-size config file list
      const file = await this.safeReadFile(actualPath, result, { redact });
      if (file) {
        // Use virtual path: ~/.hermes/<profile-name>/<relative>
        file.path = join("~/.hermes", profile.name, relative);
        result.files.push(file);
      }
    }

    // Collect skill names (list only, not content)
    const skills = await this.collectSkillNames(profile, result);

    // Add profile as a list item
    result.lists.push({
      name: profile.name,
      meta: {
        type: profile.type,
        skillsCount: String(skills.length),
      },
    });

    // Add individual skills as list items
    result.lists.push(...skills);
  }

  /**
   * List skill directory names from a profile's skills/ folder.
   * Each skill is a directory containing a SKILL.md file.
   */
  private async collectSkillNames(
    profile: HermesProfile,
    result: CollectorResult,
  ): Promise<CollectedListItem[]> {
    const items: CollectedListItem[] = [];
    const skillsDir = join(profile.dir, "skills");

    try {
      const entries = await readdir(skillsDir, { withFileTypes: true });
      for (const entry of entries) {
        if (!entry.isDirectory()) continue;
        items.push({
          name: entry.name,
          meta: {
            profile: profile.name,
            type: "skill",
          },
        });
      }
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== "ENOENT") {
        result.errors.push(
          `Failed to read skills directory ${skillsDir}: ${(err as Error).message}`,
        );
      }
    }

    return items;
  }
}
