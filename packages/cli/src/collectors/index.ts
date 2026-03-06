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

/**
 * Create all default collectors targeting the current system.
 */
export function createDefaultCollectors(
  homeDir: string = homedir()
): Collector[] {
  return [
    new ClaudeConfigCollector(homeDir),
    new OpenCodeConfigCollector(homeDir),
    new ShellConfigCollector(homeDir),
    new HomebrewCollector(homeDir),
    new ApplicationsCollector(homeDir),
  ];
}
