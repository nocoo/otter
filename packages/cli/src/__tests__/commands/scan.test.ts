import { describe, it, expect, vi } from "vitest";
import { executeScan } from "../../commands/scan.js";
import type { Collector, CollectorResult } from "@otter/core";

function mockCollector(id: string, files: number, lists: number): Collector {
  const result: CollectorResult = {
    id,
    label: id,
    category: "config",
    files: Array.from({ length: files }, (_, i) => ({
      path: `/fake/${id}/file-${i}`,
      content: `content-${i}`,
      sizeBytes: 10,
    })),
    lists: Array.from({ length: lists }, (_, i) => ({
      name: `item-${i}`,
    })),
    errors: [],
    durationMs: 5,
  };
  return {
    id,
    label: id,
    category: "config",
    collect: vi.fn().mockResolvedValue(result),
  };
}

describe("executeScan", () => {
  it("should run all collectors and return snapshot", async () => {
    const collectors = [
      mockCollector("c1", 2, 0),
      mockCollector("c2", 0, 3),
    ];

    const snapshot = await executeScan(collectors);

    expect(snapshot.collectors).toHaveLength(2);
    expect(snapshot.collectors[0].files).toHaveLength(2);
    expect(snapshot.collectors[1].lists).toHaveLength(3);
  });

  it("should return a valid snapshot structure", async () => {
    const snapshot = await executeScan([]);

    expect(snapshot.version).toBe(1);
    expect(snapshot.id).toBeDefined();
    expect(snapshot.createdAt).toBeDefined();
    expect(snapshot.machine).toBeDefined();
    expect(snapshot.collectors).toEqual([]);
  });

  it("should call onProgress callback for each collector", async () => {
    const collectors = [
      mockCollector("c1", 1, 0),
      mockCollector("c2", 1, 0),
      mockCollector("c3", 0, 1),
    ];
    const progress = vi.fn();

    await executeScan(collectors, { onProgress: progress });

    expect(progress).toHaveBeenCalledTimes(3);
    expect(progress).toHaveBeenCalledWith("c1", expect.any(Object));
    expect(progress).toHaveBeenCalledWith("c2", expect.any(Object));
    expect(progress).toHaveBeenCalledWith("c3", expect.any(Object));
  });
});
