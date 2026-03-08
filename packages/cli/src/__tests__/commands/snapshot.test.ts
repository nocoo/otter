import { describe, it, expect } from "vitest";
import {
  formatSnapshotList,
  formatSnapshotDetail,
  diffSnapshots,
  formatSnapshotDiff,
  formatSize,
  formatDate,
} from "../../commands/snapshot.js";
import type { SnapshotMeta } from "../../storage/local.js";
import type { Snapshot, CollectorResult } from "@otter/core";

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

function makeCollector(overrides: Partial<CollectorResult> = {}): CollectorResult {
  return {
    id: "shell-config",
    label: "Shell Config",
    category: "config",
    files: [
      { path: "/Users/tester/.zshrc", content: "# zsh", sizeBytes: 5 },
    ],
    lists: [{ name: "zsh" }, { name: "bash" }],
    errors: [],
    skipped: [],
    durationMs: 42,
    ...overrides,
  };
}

function makeSnapshot(overrides: Partial<Snapshot> = {}): Snapshot {
  return {
    version: 1,
    id: "abcdef12-3456-7890-abcd-ef1234567890",
    createdAt: "2026-03-06T12:30:00.000Z",
    machine: {
      hostname: "test-mac",
      platform: "darwin",
      osVersion: "15.0.0",
      arch: "arm64",
      username: "tester",
      homeDir: "/Users/tester",
      nodeVersion: "22.0.0",
    },
    collectors: [makeCollector()],
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// formatSnapshotList
// ---------------------------------------------------------------------------

describe("formatSnapshotList", () => {
  it("should show 'no snapshots' message when list is empty", () => {
    const output = formatSnapshotList([]);
    expect(output).toContain("No local snapshots found.");
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
    // Table columns: Collectors, Files, Items (header) + numeric values
    expect(output).toContain("Collectors");
    expect(output).toContain("5");
    expect(output).toContain("21");
    expect(output).toContain("201");
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

// ---------------------------------------------------------------------------
// formatSnapshotDetail
// ---------------------------------------------------------------------------

describe("formatSnapshotDetail", () => {
  it("should show short ID in header", () => {
    const output = formatSnapshotDetail(makeSnapshot());
    expect(output).toContain("abcdef12");
  });

  it("should show machine info", () => {
    const output = formatSnapshotDetail(makeSnapshot());
    expect(output).toContain("test-mac");
    expect(output).toContain("darwin/arm64");
    expect(output).toContain("tester");
  });

  it("should list collector with file and item counts", () => {
    const output = formatSnapshotDetail(makeSnapshot());
    expect(output).toContain("Shell Config");
    expect(output).toContain("1 files");
    expect(output).toContain("2 items");
  });

  it("should show file paths", () => {
    const output = formatSnapshotDetail(makeSnapshot());
    // Paths are shortened: /Users/tester/.zshrc → ~/.zshrc
    expect(output).toContain("~/.zshrc");
  });

  it("should preview list items", () => {
    const output = formatSnapshotDetail(makeSnapshot());
    expect(output).toContain("zsh, bash");
  });

  it("should truncate list preview at 10 items", () => {
    const lists = Array.from({ length: 15 }, (_, i) => ({ name: `pkg-${i}` }));
    const snapshot = makeSnapshot({
      collectors: [makeCollector({ lists })],
    });
    const output = formatSnapshotDetail(snapshot);
    expect(output).toContain("+5 more");
  });

  it("should show collector errors", () => {
    const snapshot = makeSnapshot({
      collectors: [makeCollector({ errors: ["permission denied"] })],
    });
    const output = formatSnapshotDetail(snapshot);
    expect(output).toContain("permission denied");
  });
});

// ---------------------------------------------------------------------------
// diffSnapshots
// ---------------------------------------------------------------------------

describe("diffSnapshots", () => {
  it("should detect no differences for identical snapshots", () => {
    const snap = makeSnapshot();
    const diff = diffSnapshots(snap, snap);
    expect(diff.addedCollectors).toEqual([]);
    expect(diff.removedCollectors).toEqual([]);
    expect(diff.collectors).toEqual([]);
  });

  it("should detect added collector", () => {
    const oldSnap = makeSnapshot({ collectors: [] });
    const newSnap = makeSnapshot({ collectors: [makeCollector()] });
    const diff = diffSnapshots(oldSnap, newSnap);
    expect(diff.addedCollectors).toEqual(["Shell Config"]);
  });

  it("should detect removed collector", () => {
    const oldSnap = makeSnapshot({ collectors: [makeCollector()] });
    const newSnap = makeSnapshot({ collectors: [] });
    const diff = diffSnapshots(oldSnap, newSnap);
    expect(diff.removedCollectors).toEqual(["Shell Config"]);
  });

  it("should detect added files", () => {
    const oldSnap = makeSnapshot({
      collectors: [makeCollector({ files: [] })],
    });
    const newSnap = makeSnapshot({
      collectors: [
        makeCollector({
          files: [{ path: "/Users/tester/.bashrc", content: "# bash", sizeBytes: 6 }],
        }),
      ],
    });
    const diff = diffSnapshots(oldSnap, newSnap);
    expect(diff.collectors).toHaveLength(1);
    expect(diff.collectors[0].files).toEqual([
      { type: "added", label: "/Users/tester/.bashrc" },
    ]);
  });

  it("should detect removed files", () => {
    const oldSnap = makeSnapshot({
      collectors: [
        makeCollector({
          files: [{ path: "/Users/tester/.zshrc", content: "# zsh", sizeBytes: 5 }],
        }),
      ],
    });
    const newSnap = makeSnapshot({
      collectors: [makeCollector({ files: [] })],
    });
    const diff = diffSnapshots(oldSnap, newSnap);
    expect(diff.collectors[0].files).toEqual([
      { type: "removed", label: "/Users/tester/.zshrc" },
    ]);
  });

  it("should detect changed files by size difference", () => {
    const oldSnap = makeSnapshot({
      collectors: [
        makeCollector({
          files: [{ path: "/Users/tester/.zshrc", content: "# zsh", sizeBytes: 5 }],
        }),
      ],
    });
    const newSnap = makeSnapshot({
      collectors: [
        makeCollector({
          files: [
            { path: "/Users/tester/.zshrc", content: "# zsh updated", sizeBytes: 99 },
          ],
        }),
      ],
    });
    const diff = diffSnapshots(oldSnap, newSnap);
    expect(diff.collectors[0].files).toEqual([
      { type: "changed", label: "/Users/tester/.zshrc" },
    ]);
  });

  it("should detect added list items", () => {
    const oldSnap = makeSnapshot({
      collectors: [makeCollector({ lists: [{ name: "zsh" }] })],
    });
    const newSnap = makeSnapshot({
      collectors: [
        makeCollector({ lists: [{ name: "zsh" }, { name: "fish" }] }),
      ],
    });
    const diff = diffSnapshots(oldSnap, newSnap);
    expect(diff.collectors[0].lists).toEqual([
      { type: "added", label: "fish" },
    ]);
  });

  it("should detect removed list items", () => {
    const oldSnap = makeSnapshot({
      collectors: [
        makeCollector({ lists: [{ name: "zsh" }, { name: "bash" }] }),
      ],
    });
    const newSnap = makeSnapshot({
      collectors: [makeCollector({ lists: [{ name: "zsh" }] })],
    });
    const diff = diffSnapshots(oldSnap, newSnap);
    expect(diff.collectors[0].lists).toEqual([
      { type: "removed", label: "bash" },
    ]);
  });

  it("should set correct old and new IDs", () => {
    const oldSnap = makeSnapshot({ id: "aaaa1111-0000-0000-0000-000000000000" });
    const newSnap = makeSnapshot({ id: "bbbb2222-0000-0000-0000-000000000000" });
    const diff = diffSnapshots(oldSnap, newSnap);
    expect(diff.oldId).toBe("aaaa1111");
    expect(diff.newId).toBe("bbbb2222");
  });

  it("should skip collectors with no differences", () => {
    const snap1 = makeSnapshot();
    const snap2 = makeSnapshot({
      id: "11111111-0000-0000-0000-000000000000",
    });
    const diff = diffSnapshots(snap1, snap2);
    // Same collectors, same files, same lists — no collector diffs
    expect(diff.collectors).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// formatSnapshotDiff
// ---------------------------------------------------------------------------

describe("formatSnapshotDiff", () => {
  it("should show 'no differences' for empty diff", () => {
    const output = formatSnapshotDiff({
      oldId: "aaaa1111",
      newId: "bbbb2222",
      addedCollectors: [],
      removedCollectors: [],
      collectors: [],
    });
    expect(output).toContain("No differences found.");
  });

  it("should show added and removed collectors", () => {
    const output = formatSnapshotDiff({
      oldId: "aaaa1111",
      newId: "bbbb2222",
      addedCollectors: ["New Collector"],
      removedCollectors: ["Old Collector"],
      collectors: [],
    });
    expect(output).toContain("New Collector");
    expect(output).toContain("Old Collector");
  });

  it("should show file and list diffs with prefixes", () => {
    const output = formatSnapshotDiff({
      oldId: "aaaa1111",
      newId: "bbbb2222",
      addedCollectors: [],
      removedCollectors: [],
      collectors: [
        {
          collectorId: "shell-config",
          collectorLabel: "Shell Config",
          files: [
            { type: "added", label: "/Users/tester/.bashrc" },
            { type: "removed", label: "/Users/tester/.zshrc" },
            { type: "changed", label: "/Users/tester/.gitconfig" },
          ],
          lists: [
            { type: "added", label: "fish" },
            { type: "removed", label: "bash" },
          ],
        },
      ],
    });
    expect(output).toContain("Shell Config");
    expect(output).toContain("/Users/tester/.bashrc");
    expect(output).toContain("/Users/tester/.zshrc");
    expect(output).toContain("/Users/tester/.gitconfig");
    expect(output).toContain("fish");
    expect(output).toContain("bash");
  });

  it("should show both snapshot IDs in header", () => {
    const output = formatSnapshotDiff({
      oldId: "aaaa1111",
      newId: "bbbb2222",
      addedCollectors: [],
      removedCollectors: [],
      collectors: [],
    });
    expect(output).toContain("aaaa1111");
    expect(output).toContain("bbbb2222");
  });
});

// ---------------------------------------------------------------------------
// formatSize
// ---------------------------------------------------------------------------

describe("formatSize", () => {
  it("should format bytes", () => {
    expect(formatSize(500)).toBe("500 B");
  });

  it("should format kilobytes", () => {
    expect(formatSize(71_000)).toBe("69.3 KB");
  });

  it("should format large kilobytes with decimals", () => {
    expect(formatSize(512_000)).toBe("500.0 KB");
  });

  it("should format megabytes", () => {
    expect(formatSize(1_153_000)).toBe("1.10 MB");
  });
});

// ---------------------------------------------------------------------------
// formatDate
// ---------------------------------------------------------------------------

describe("formatDate", () => {
  it("should format ISO date to short form", () => {
    expect(formatDate("2026-03-06T12:30:00.000Z")).toMatch(
      /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/
    );
  });

  it("should pad single-digit months and hours", () => {
    const result = formatDate("2026-01-05T03:07:00.000Z");
    expect(result).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/);
  });
});
