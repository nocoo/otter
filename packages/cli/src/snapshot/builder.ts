import { randomUUID } from "node:crypto";
import { hostname, platform, release, arch, userInfo, homedir } from "node:os";
import type { Collector, CollectorResult, MachineInfo, Snapshot } from "@otter/core";

/**
 * Gather current machine information for the snapshot.
 */
function getMachineInfo(): MachineInfo {
  const user = userInfo();
  return {
    hostname: hostname(),
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
