import type { Collector, CollectorResult } from "@otter/core";
import { describe, expect, it, vi } from "vitest";

// Mocks for node:os/child_process must be declared before importing builder.
const platformMock = vi.fn(() => "darwin");
const execSyncMock = vi.fn(() => "MyMac");
vi.mock("node:os", async () => {
  const actual = await vi.importActual<typeof import("node:os")>("node:os");
  return {
    ...actual,
    platform: () => platformMock(),
  };
});
vi.mock("node:child_process", async () => {
  const actual = await vi.importActual<typeof import("node:child_process")>("node:child_process");
  return {
    ...actual,
    execSync: (cmd: string, opts?: object) => execSyncMock(cmd, opts),
  };
});

import { buildSnapshot } from "../../snapshot/builder.js";

/** Create a mock collector for testing */
function mockCollector(overrides: Partial<CollectorResult> & { id: string }): Collector {
  const result: CollectorResult = {
    id: overrides.id,
    label: overrides.label ?? overrides.id,
    category: overrides.category ?? "config",
    files: overrides.files ?? [],
    lists: overrides.lists ?? [],
    errors: overrides.errors ?? [],
    skipped: overrides.skipped ?? [],
    durationMs: overrides.durationMs ?? 10,
  };

  return {
    id: result.id,
    label: result.label,
    category: result.category,
    collect: vi.fn().mockResolvedValue(result),
  };
}

describe("buildSnapshot", () => {
  it("should create a snapshot with correct schema version", async () => {
    const snapshot = await buildSnapshot([]);
    expect(snapshot.version).toBe(1);
  });

  it("should include an ISO 8601 timestamp", async () => {
    const before = new Date().toISOString();
    const snapshot = await buildSnapshot([]);
    const after = new Date().toISOString();

    expect(snapshot.createdAt >= before).toBe(true);
    expect(snapshot.createdAt <= after).toBe(true);
  });

  it("should generate a unique UUID for each snapshot", async () => {
    const s1 = await buildSnapshot([]);
    const s2 = await buildSnapshot([]);

    expect(s1.id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    expect(s1.id).not.toBe(s2.id);
  });

  it("should include machine information", async () => {
    const snapshot = await buildSnapshot([]);

    expect(snapshot.machine).toBeDefined();
    expect(snapshot.machine.platform).toBe("darwin");
    expect(typeof snapshot.machine.hostname).toBe("string");
    expect(typeof snapshot.machine.computerName).toBe("string");
    // biome-ignore lint/style/noNonNullAssertion: computerName may be null on some systems but we test it exists
    expect(snapshot.machine.computerName!.length).toBeGreaterThan(0);
    expect(typeof snapshot.machine.username).toBe("string");
    expect(typeof snapshot.machine.homeDir).toBe("string");
    expect(typeof snapshot.machine.arch).toBe("string");
    expect(typeof snapshot.machine.osVersion).toBe("string");
    expect(typeof snapshot.machine.nodeVersion).toBe("string");
  });

  it("should run all collectors and aggregate results", async () => {
    const c1 = mockCollector({
      id: "test-1",
      files: [{ path: "/a", content: "a", sizeBytes: 1 }],
    });
    const c2 = mockCollector({
      id: "test-2",
      lists: [{ name: "pkg-1" }],
    });

    const snapshot = await buildSnapshot([c1, c2]);

    expect(snapshot.collectors).toHaveLength(2);
    expect(snapshot.collectors[0].id).toBe("test-1");
    expect(snapshot.collectors[0].files).toHaveLength(1);
    expect(snapshot.collectors[1].id).toBe("test-2");
    expect(snapshot.collectors[1].lists).toHaveLength(1);

    expect(c1.collect).toHaveBeenCalledOnce();
    expect(c2.collect).toHaveBeenCalledOnce();
  });

  it("should handle collector errors without crashing", async () => {
    const failing: Collector = {
      id: "failing",
      label: "Failing Collector",
      category: "config",
      collect: vi.fn().mockRejectedValue(new Error("boom")),
    };

    const snapshot = await buildSnapshot([failing]);

    // Should still produce a snapshot
    expect(snapshot.collectors).toHaveLength(1);
    expect(snapshot.collectors[0].errors).toContain("Collector 'failing' crashed: boom");
  });

  it("should produce valid JSON when serialized", async () => {
    const c = mockCollector({
      id: "json-test",
      files: [{ path: "/test", content: "hello\nworld", sizeBytes: 11 }],
    });

    const snapshot = await buildSnapshot([c]);
    const json = JSON.stringify(snapshot);
    const parsed = JSON.parse(json);

    expect(parsed.version).toBe(1);
    expect(parsed.collectors[0].files[0].content).toBe("hello\nworld");
  });

  it("omits computerName on non-darwin platforms", async () => {
    platformMock.mockReturnValue("linux");
    try {
      const snapshot = await buildSnapshot([]);
      expect(snapshot.machine.computerName).toBeUndefined();
      expect(snapshot.machine.platform).toBe("linux");
    } finally {
      platformMock.mockReturnValue("darwin");
    }
  });

  it("omits computerName when scutil command fails", async () => {
    platformMock.mockReturnValueOnce("darwin");
    execSyncMock.mockImplementationOnce(() => {
      throw new Error("scutil not found");
    });
    const snapshot = await buildSnapshot([]);
    expect(snapshot.machine.computerName).toBeUndefined();
  });
});
