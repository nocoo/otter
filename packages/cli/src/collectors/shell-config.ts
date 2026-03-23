import { readdir, stat } from "node:fs/promises";
import { join } from "node:path";
import type { CollectedListItem, CollectorCategory, CollectorResult } from "@otter/core";
import { BaseCollector } from "./base.js";

/** Well-known dotfiles to collect from home directory */
const DOTFILES: Array<{ name: string; redact?: boolean }> = [
  { name: ".zshrc", redact: true },
  { name: ".zprofile", redact: true },
  { name: ".zshenv", redact: true },
  { name: ".zlogin", redact: true },
  { name: ".bashrc", redact: true },
  { name: ".bash_profile", redact: true },
  { name: ".profile", redact: true },
  { name: ".gitconfig", redact: true },
  { name: ".gitignore_global" },
  { name: ".vimrc" },
  { name: ".npmrc", redact: true },
  { name: ".yarnrc" },
  { name: ".editorconfig" },
  { name: ".tmux.conf", redact: true },
  { name: ".wgetrc", redact: true },
  { name: ".curlrc", redact: true },
  { name: ".hushlogin" },
  { name: ".netrc", redact: true },
];

/** Files inside ~/.ssh/ that are safe to collect (config only, no keys) */
const SSH_SAFE_FILES = ["config", "known_hosts"];

/** Well-known SSH key filename patterns (without path) */
const SSH_PRIVATE_KEY_PATTERNS = [
  /^id_/, // id_rsa, id_ed25519, id_ecdsa, id_dsa, id_*
  /^identity$/, // legacy SSH1
];

/** Extensions that indicate public keys */
const SSH_PUBLIC_KEY_EXT = ".pub";

/** Files in ~/.ssh/ that are NOT keys (skip during key detection) */
const SSH_NON_KEY_FILES = new Set([
  "config",
  "known_hosts",
  "known_hosts.old",
  "authorized_keys",
  "authorized_keys2",
  "environment",
  "rc",
  "agent",
]);

/**
 * Classify an SSH filename as a key type, or null if not a key.
 * Exported for testing.
 */
export function classifySshFile(name: string): "private-key" | "public-key" | null {
  if (SSH_NON_KEY_FILES.has(name)) return null;

  // Public key check first (foo.pub)
  if (name.endsWith(SSH_PUBLIC_KEY_EXT)) {
    return "public-key";
  }

  // Private key patterns
  for (const pattern of SSH_PRIVATE_KEY_PATTERNS) {
    if (pattern.test(name)) return "private-key";
  }

  return null;
}

/**
 * Collects shell and developer environment configuration files:
 * - Common dotfiles (.zshrc, .bashrc, .gitconfig, etc.)
 * - SSH config (but NOT private/public keys — only presence indicators)
 */
export class ShellConfigCollector extends BaseCollector {
  readonly id = "shell-config";
  readonly label = "Shell Configuration";
  readonly category: CollectorCategory = "environment";

  async collect(): Promise<CollectorResult> {
    return this.timed(async (result) => {
      // 1. Collect well-known dotfiles
      for (const { name: dotfile, redact } of DOTFILES) {
        const file = await this.safeReadFile(join(this.homeDir, dotfile), result, {
          ...(redact !== undefined ? { redact } : {}),
        });
        if (file) result.files.push(file);
      }

      // 2. Collect safe SSH config files
      for (const sshFile of SSH_SAFE_FILES) {
        const file = await this.safeReadFile(join(this.homeDir, ".ssh", sshFile), result);
        if (file) result.files.push(file);
      }

      // 3. Detect SSH key presence (never collect key content)
      const sshKeys = await this.detectSshKeys(result);
      result.lists.push(...sshKeys);
    });
  }

  /**
   * Scan ~/.ssh/ for key files and return presence indicators.
   * Key content is NEVER read — only filenames and metadata.
   */
  private async detectSshKeys(result: CollectorResult): Promise<CollectedListItem[]> {
    const sshDir = join(this.homeDir, ".ssh");
    const items: CollectedListItem[] = [];

    try {
      const entries = await readdir(sshDir, { withFileTypes: true });
      for (const entry of entries) {
        if (!entry.isFile()) continue;

        const keyType = classifySshFile(entry.name);
        if (!keyType) continue;

        // Stat for modification time (useful for identifying stale keys)
        let modifiedAt: string | undefined;
        try {
          const info = await stat(join(sshDir, entry.name));
          modifiedAt = info.mtime.toISOString();
        } catch {
          // stat failure is non-fatal
        }

        items.push({
          name: entry.name,
          meta: {
            type: keyType,
            source: ".ssh",
            ...(modifiedAt ? { modifiedAt } : {}),
          },
        });
      }
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== "ENOENT") {
        result.errors.push(`Failed to scan SSH directory: ${(err as Error).message}`);
      }
    }

    return items;
  }
}
