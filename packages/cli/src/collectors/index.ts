export { BaseCollector } from "./base.js";
export { ClaudeConfigCollector } from "./claude-config.js";
export { OpenCodeConfigCollector } from "./opencode-config.js";
export { ShellConfigCollector } from "./shell-config.js";
export { HomebrewCollector } from "./homebrew.js";
export { ApplicationsCollector } from "./applications.js";

import type { Collector } from "@otter/core";
import { ClaudeConfigCollector } from "./claude-config.js";
import { OpenCodeConfigCollector } from "./opencode-config.js";
import { ShellConfigCollector } from "./shell-config.js";
import { HomebrewCollector } from "./homebrew.js";
import { ApplicationsCollector } from "./applications.js";
import { homedir } from "node:os";

/** Default R2 public base URL for app icon assets */
const DEFAULT_ICON_BASE_URL = "https://s.zhe.to/apps/otter";

/**
 * Options for creating the default set of collectors.
 */
export interface CollectorOptions {
  /** If true, exclude behavior data (history.jsonl, session summaries) */
  slim?: boolean;
  /** Base URL for deterministic icon URLs (default: s.zhe.to/apps/otter) */
  iconBaseUrl?: string;
}

/**
 * Create all default collectors targeting the current system.
 */
export function createDefaultCollectors(
  homeDir: string = homedir(),
  options: CollectorOptions = {}
): Collector[] {
  const iconBaseUrl = options.iconBaseUrl ?? DEFAULT_ICON_BASE_URL;
  return [
    new ClaudeConfigCollector(homeDir, { slim: options.slim }),
    new OpenCodeConfigCollector(homeDir),
    new ShellConfigCollector(homeDir),
    new HomebrewCollector(homeDir),
    new ApplicationsCollector(homeDir, "/Applications", iconBaseUrl),
  ];
}
