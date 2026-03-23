export { ApplicationsCollector } from "./applications.js";
export { BaseCollector } from "./base.js";
export { ClaudeConfigCollector } from "./claude-config.js";
export { CloudCLICollector } from "./cloud-cli.js";
export { DevToolchainCollector } from "./dev-toolchain.js";
export { DockerCollector } from "./docker.js";
export { FontsCollector } from "./fonts.js";
export { HomebrewCollector } from "./homebrew.js";
export { LaunchAgentsCollector } from "./launch-agents.js";
export { MacOSDefaultsCollector } from "./macos-defaults.js";
export { OpenCodeConfigCollector } from "./opencode-config.js";
export { ShellConfigCollector } from "./shell-config.js";
export { VSCodeCollector } from "./vscode.js";

import { homedir } from "node:os";
import type { Collector } from "@otter/core";
import { ApplicationsCollector } from "./applications.js";
import { ClaudeConfigCollector } from "./claude-config.js";
import { CloudCLICollector } from "./cloud-cli.js";
import { DevToolchainCollector } from "./dev-toolchain.js";
import { DockerCollector } from "./docker.js";
import { FontsCollector } from "./fonts.js";
import { HomebrewCollector } from "./homebrew.js";
import { LaunchAgentsCollector } from "./launch-agents.js";
import { MacOSDefaultsCollector } from "./macos-defaults.js";
import { OpenCodeConfigCollector } from "./opencode-config.js";
import { ShellConfigCollector } from "./shell-config.js";
import { VSCodeCollector } from "./vscode.js";

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
  options: CollectorOptions = {},
): Collector[] {
  const iconBaseUrl = options.iconBaseUrl ?? DEFAULT_ICON_BASE_URL;
  return [
    new ClaudeConfigCollector(homeDir, { slim: options.slim }),
    new OpenCodeConfigCollector(homeDir),
    new ShellConfigCollector(homeDir),
    new HomebrewCollector(homeDir),
    new ApplicationsCollector(homeDir, "/Applications", iconBaseUrl),
    new VSCodeCollector(homeDir),
    new DockerCollector(homeDir),
    new FontsCollector(homeDir),
    new DevToolchainCollector(homeDir),
    new CloudCLICollector(homeDir),
    new MacOSDefaultsCollector(homeDir),
    new LaunchAgentsCollector(homeDir),
  ];
}
