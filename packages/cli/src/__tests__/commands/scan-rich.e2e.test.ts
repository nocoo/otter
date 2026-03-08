import { describe, it, expect } from "vitest";
import { executeScan } from "../../commands/scan.js";
import type { Collector, CollectorResult } from "@otter/core";

describe("executeScan rich collector integration", () => {
  it("preserves enriched list metadata across multiple collectors", async () => {
    const collectors: Collector[] = [
      {
        id: "homebrew",
        label: "Homebrew Packages",
        category: "environment",
        collect: async (): Promise<CollectorResult> => ({
          id: "homebrew",
          label: "Homebrew Packages",
          category: "environment",
          files: [],
          lists: [
            {
              name: "bun",
              version: "1.3.9",
              meta: { type: "formula", pinned: "true" },
            },
            { name: "homebrew/cask", meta: { type: "tap" } },
          ],
          errors: [],
          skipped: [],
          durationMs: 5,
        }),
      },
      {
        id: "vscode",
        label: "VS Code / Cursor Configuration",
        category: "config",
        collect: async (): Promise<CollectorResult> => ({
          id: "vscode",
          label: "VS Code / Cursor Configuration",
          category: "config",
          files: [
            {
              path: "/tmp/Library/Application Support/Code/User/settings.json",
              content: '{"token":"[REDACTED]"}',
              sizeBytes: 24,
            },
          ],
          lists: [
            {
              name: "github.copilot",
              version: "1.300.0",
              meta: { type: "vscode-extension", editor: "vscode" },
            },
          ],
          errors: [],
          skipped: [],
          durationMs: 6,
        }),
      },
    ];

    const snapshot = await executeScan(collectors);

    expect(snapshot.collectors).toHaveLength(2);
    expect(snapshot.collectors[0].lists[0].meta?.pinned).toBe("true");
    expect(snapshot.collectors[1].files[0].content).toContain("[REDACTED]");
    expect(snapshot.collectors[1].lists[0].meta?.editor).toBe("vscode");
  });
});
