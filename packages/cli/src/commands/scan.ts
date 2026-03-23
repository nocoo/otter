import type { Collector, CollectorResult, Snapshot } from "@otter/core";
import { buildSnapshot } from "../snapshot/builder.js";

export interface ScanOptions {
  /** Called when a collector is about to start */
  onStart?: (collectorId: string, label: string) => void;
  /** Called after each collector finishes */
  onProgress?: (collectorId: string, result: CollectorResult) => void;
}

/**
 * Execute the scan operation: run all collectors and build a snapshot.
 * This is the pure logic function, decoupled from CLI I/O.
 */
export async function executeScan(
  collectors: Collector[],
  options: ScanOptions = {},
): Promise<Snapshot> {
  // Run collectors sequentially to allow progress reporting
  const results: CollectorResult[] = [];
  for (const collector of collectors) {
    options.onStart?.(collector.id, collector.label);
    let result: CollectorResult;
    try {
      result = await collector.collect();
    } catch (err) {
      result = {
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
    results.push(result);
    options.onProgress?.(collector.id, result);
  }

  // Build snapshot with pre-collected results
  // We bypass buildSnapshot's internal collection since we already ran them
  const snapshot = await buildSnapshot([]);
  snapshot.collectors = results;
  return snapshot;
}
