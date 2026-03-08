import { randomUUID } from "node:crypto";
import { execSync } from "node:child_process";
import { hostname, platform, release, arch, userInfo, homedir } from "node:os";
import type { Collector, CollectorResult, MachineInfo, Snapshot } from "@otter/core";

/**
 * Get the user-friendly computer name on macOS via `scutil --get ComputerName`.
 * Returns undefined on non-macOS platforms or if the command fails.
 */
function getComputerName(): string | undefined {
  if (platform() !== "darwin") return undefined;
  try {
    return execSync("scutil --get ComputerName", { encoding: "utf-8" }).trim();
  } catch {
    return undefined;
  }
}

/**
 * Gather current machine information for the snapshot.
 */
function getMachineInfo(): MachineInfo {
  const user = userInfo();
  return {
    hostname: hostname(),
    computerName: getComputerName(),
    platform: platform(),
    osVersion: release(),
    arch: arch(),
    username: user.username,
    homeDir: homedir(),
    nodeVersion: process.version,
  };
}

/**
 * Run a single collector, catching any crashes and converting
 * them into error entries within the result.
 */
async function runCollector(collector: Collector): Promise<CollectorResult> {
  try {
    return await collector.collect();
  } catch (err) {
    return {
      id: collector.id,
      label: collector.label,
      category: collector.category,
      files: [],
      lists: [],
      errors: [`Collector '${collector.id}' crashed: ${(err as Error).message}`],
      skipped: [],
      durationMs: 0,
    };
  }
}

/**
 * Build a complete snapshot by running all provided collectors
 * and assembling results into the unified Snapshot format.
 */
export async function buildSnapshot(
  collectors: Collector[]
): Promise<Snapshot> {
  const results = await Promise.all(collectors.map(runCollector));

  return {
    version: 1,
    createdAt: new Date().toISOString(),
    id: randomUUID(),
    machine: getMachineInfo(),
    collectors: results,
  };
}
