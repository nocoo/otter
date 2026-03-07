import { describe, it, expect } from "vitest";
import {
  filterCollectors,
  getCollectorOverview,
  matchesCollectorQuery,
  type SnapshotCollector,
} from "@/lib/snapshot-collectors";

const collectors: SnapshotCollector[] = [
  {
    id: "homebrew",
    label: "Homebrew Packages",
    category: "environment",
    files: [],
    lists: [
      { name: "bun", version: "1.3.9", meta: { type: "formula", pinned: "true" } },
    ],
    errors: [],
  },
  {
    id: "vscode",
    label: "VS Code / Cursor Configuration",
    category: "config",
    files: [{ path: "/tmp/settings.json", sizeBytes: 24, content: "{}" }],
    lists: [
      {
        name: "github.copilot",
        version: "1.300.0",
        meta: { type: "vscode-extension", editor: "vscode" },
      },
    ],
    errors: ["Skipped cursor: not installed"],
  },
];

const homebrewCollector = collectors[0]!;
const vscodeCollector = collectors[1]!;

describe("snapshot collector helpers", () => {
  it("matches against collector metadata and list content", () => {
    expect(matchesCollectorQuery(homebrewCollector, "pinned")).toBe(true);
    expect(matchesCollectorQuery(vscodeCollector, "github.copilot")).toBe(true);
    expect(matchesCollectorQuery(vscodeCollector, "settings.json")).toBe(true);
    expect(matchesCollectorQuery(vscodeCollector, "docker")).toBe(false);
  });

  it("filters by category and query", () => {
    expect(filterCollectors(collectors, { query: "", category: "config" })).toEqual([
      collectors[1],
    ]);
    expect(filterCollectors(collectors, { query: "bun", category: "all" })).toEqual([
      collectors[0],
    ]);
  });

  it("builds collector overview counts", () => {
    const visible = filterCollectors(collectors, { query: "code", category: "all" });
    expect(getCollectorOverview(collectors, visible)).toEqual({
      total: 2,
      visible: 1,
      config: 1,
      environment: 1,
      withErrors: 1,
    });
  });
});
