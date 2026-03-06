import { join } from "node:path";
import { BaseCollector } from "./base.js";
import type { CollectorCategory, CollectorResult } from "@otter/core";

/** Well-known dotfiles to collect from home directory */
const DOTFILES: Array<{ name: string; redact?: boolean }> = [
  { name: ".zshrc" },
  { name: ".zprofile" },
  { name: ".zshenv" },
  { name: ".zlogin" },
  { name: ".bashrc" },
  { name: ".bash_profile" },
  { name: ".profile" },
  { name: ".gitconfig", redact: true },
  { name: ".gitignore_global" },
  { name: ".vimrc" },
  { name: ".npmrc", redact: true },
  { name: ".yarnrc" },
  { name: ".editorconfig" },
  { name: ".tmux.conf" },
  { name: ".wgetrc" },
  { name: ".curlrc" },
  { name: ".hushlogin" },
  { name: ".netrc", redact: true },
];

/** Files inside ~/.ssh/ that are safe to collect (config only, no keys) */
const SSH_SAFE_FILES = ["config", "known_hosts"];

/**
 * Collects shell and developer environment configuration files:
 * - Common dotfiles (.zshrc, .bashrc, .gitconfig, etc.)
 * - SSH config (but NOT private/public keys)
 */
export class ShellConfigCollector extends BaseCollector {
  readonly id = "shell-config";
  readonly label = "Shell Configuration";
  readonly category: CollectorCategory = "environment";

  async collect(): Promise<CollectorResult> {
    return this.timed(async (result) => {
      // 1. Collect well-known dotfiles
      for (const { name: dotfile, redact } of DOTFILES) {
        const file = await this.safeReadFile(
          join(this.homeDir, dotfile),
          result,
          { redact }
        );
        if (file) result.files.push(file);
      }

      // 2. Collect safe SSH config files
      for (const sshFile of SSH_SAFE_FILES) {
        const file = await this.safeReadFile(
          join(this.homeDir, ".ssh", sshFile),
          result
        );
        if (file) result.files.push(file);
      }
    });
  }
}
