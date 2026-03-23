import { exec } from "node:child_process";
import { promisify } from "node:util";
import type { CollectedListItem, CollectorCategory, CollectorResult } from "@otter/core";
import { BaseCollector } from "./base.js";

const execAsync = promisify(exec);

function parseVersionedItems(output: string, type: string): CollectedListItem[] {
  return output
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .map((line) => {
      const [name, ...versions] = line.split(/\s+/);
      if (!name) {
        return { name: "", meta: { type } };
      }
      return {
        name,
        ...(versions.length > 0 ? { version: versions.join(" ") } : {}),
        meta: { type },
      };
    });
}

function parseTapItems(output: string): CollectedListItem[] {
  return output
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .map((name) => ({ name, meta: { type: "tap" } }));
}

function applyPinnedPackages(items: CollectedListItem[], output: string): void {
  const pinned = new Set(
    output
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line.length > 0),
  );

  for (const item of items) {
    if (pinned.has(item.name)) {
      item.meta = {
        ...item.meta,
        pinned: "true",
      };
    }
  }
}

/**
 * Collects installed Homebrew packages (formulae + casks).
 * List-only: no binary content is collected.
 */
export class HomebrewCollector extends BaseCollector {
  readonly id = "homebrew";
  readonly label = "Homebrew Packages";
  readonly category: CollectorCategory = "environment";

  /** Overridable for testing — executes a shell command and returns stdout */
  _execCommand = async (cmd: string): Promise<string> => {
    const { stdout } = await execAsync(cmd);
    return stdout;
  };

  async collect(): Promise<CollectorResult> {
    return this.timed(async (result) => {
      const formulae = await this.collectList(
        "brew list --formula --versions",
        "formula",
        result,
        parseVersionedItems,
      );

      const casks = await this.collectList(
        "brew list --cask --versions",
        "cask",
        result,
        parseVersionedItems,
      );

      const items = [...formulae, ...casks];

      const taps = await this.collectList("brew tap", "tap", result, (output) =>
        parseTapItems(output),
      );
      items.push(...taps);

      await this.markPinnedPackages(items, result);
      result.lists.push(...items);
    });
  }

  private async collectList(
    cmd: string,
    type: string,
    result: CollectorResult,
    parser: (output: string, type: string) => CollectedListItem[],
  ): Promise<CollectedListItem[]> {
    try {
      const output = await this._execCommand(cmd);
      return parser(output, type);
    } catch (err) {
      result.errors.push(`Failed to run '${cmd}': ${(err as Error).message}`);
      return [];
    }
  }

  private async markPinnedPackages(
    items: CollectedListItem[],
    result: CollectorResult,
  ): Promise<void> {
    try {
      const output = await this._execCommand("brew list --pinned");
      applyPinnedPackages(items, output);
    } catch (err) {
      result.errors.push(`Failed to run 'brew list --pinned': ${(err as Error).message}`);
    }
  }
}
