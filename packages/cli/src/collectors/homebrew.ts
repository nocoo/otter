import { exec } from "node:child_process";
import { promisify } from "node:util";
import { BaseCollector } from "./base.js";
import type {
  CollectorCategory,
  CollectorResult,
  CollectedListItem,
} from "@otter/core";

const execAsync = promisify(exec);

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
      // Collect formulae
      const formulae = await this.listPackages(
        "brew list --formula",
        "formula",
        result
      );
      result.lists.push(...formulae);

      // Collect casks
      const casks = await this.listPackages(
        "brew list --cask",
        "cask",
        result
      );
      result.lists.push(...casks);
    });
  }

  private async listPackages(
    cmd: string,
    type: string,
    result: CollectorResult
  ): Promise<CollectedListItem[]> {
    try {
      const output = await this._execCommand(cmd);
      return output
        .split("\n")
        .map((line) => line.trim())
        .filter((line) => line.length > 0)
        .map((name) => ({ name, meta: { type } }));
    } catch (err) {
      result.errors.push(
        `Failed to run '${cmd}': ${(err as Error).message}`
      );
      return [];
    }
  }
}
