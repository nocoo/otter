import { readFile, writeFile, mkdir } from "node:fs/promises";
import { join, dirname } from "node:path";
import type { OtterConfig } from "@otter/core";

/**
 * Manages the CLI configuration file at ~/.config/otter/config.json
 */
export class ConfigManager {
  readonly configPath: string;

  constructor(configDir: string) {
    this.configPath = join(configDir, "config.json");
  }

  /** Load config from disk. Returns empty config if file doesn't exist or is corrupted. */
  async load(): Promise<OtterConfig> {
    try {
      const raw = await readFile(this.configPath, "utf-8");
      return JSON.parse(raw) as OtterConfig;
    } catch {
      return {};
    }
  }

  /** Save config to disk, creating the directory if needed. */
  async save(config: OtterConfig): Promise<void> {
    const dir = dirname(this.configPath);
    await mkdir(dir, { recursive: true });
    await writeFile(this.configPath, JSON.stringify(config, null, 2) + "\n");
  }
}
