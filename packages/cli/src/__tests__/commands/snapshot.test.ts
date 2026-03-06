import { describe, it, expect } from "vitest";
import { formatSnapshotList, formatSize, formatDate } from "../../commands/snapshot.js";
import type { SnapshotMeta } from "../../storage/local.js";

function makeMeta(overrides: Partial<SnapshotMeta> = {}): SnapshotMeta {
  return {
    id: "abcdef12-3456-7890-abcd-ef1234567890",
    shortId: "abcdef12",
    createdAt: "2026-03-06T12:30:00.000Z",
    filename: "2026-03-06T12-30-00_abcdef12.json",
    sizeBytes: 1_153_000,
    collectorCount: 5,
    fileCount: 21,
    listCount: 201,
    ...overrides,
  };
}

describe("formatSnapshotList", () => {
  it("should show 'no snapshots' message when list is empty", () => {
    const output = formatSnapshotList([]);
    expect(output).toBe("No local snapshots found.");
  });

  it("should show count header with single snapshot", () => {
    const output = formatSnapshotList([makeMeta()]);
    expect(output).toContain("Local snapshots (1):");
  });

  it("should include short ID in output", () => {
    const output = formatSnapshotList([makeMeta()]);
    expect(output).toContain("abcdef12");
  });

  it("should include collector, file, and item counts", () => {
    const output = formatSnapshotList([makeMeta()]);
    expect(output).toContain("5 collectors");
    expect(output).toContain("21 files");
    expect(output).toContain("201 items");
  });

  it("should list multiple snapshots with correct count", () => {
    const metas = [
      makeMeta({ shortId: "aaaa1111", id: "aaaa1111-0000-0000-0000-000000000000" }),
      makeMeta({ shortId: "bbbb2222", id: "bbbb2222-0000-0000-0000-000000000000" }),
    ];
    const output = formatSnapshotList(metas);
    expect(output).toContain("Local snapshots (2):");
    expect(output).toContain("aaaa1111");
    expect(output).toContain("bbbb2222");
  });
});

describe("formatSize", () => {
  it("should format bytes", () => {
    expect(formatSize(500)).toBe("500 B");
  });

  it("should format kilobytes", () => {
    expect(formatSize(71_000)).toBe("69.3 KB");
  });

  it("should format large kilobytes without decimals", () => {
    expect(formatSize(512_000)).toBe("500 KB");
  });

  it("should format megabytes", () => {
    expect(formatSize(1_153_000)).toBe("1.1 MB");
  });
});

describe("formatDate", () => {
  it("should format ISO date to short form", () => {
    expect(formatDate("2026-03-06T12:30:00.000Z")).toMatch(
      /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/
    );
  });

  it("should pad single-digit months and hours", () => {
    // Use a UTC timestamp and check we get a valid format
    const result = formatDate("2026-01-05T03:07:00.000Z");
    expect(result).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/);
  });
});
