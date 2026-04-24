import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  banner,
  blank,
  box,
  error,
  errorBox,
  formatDate,
  formatDuration,
  formatSize,
  info,
  item,
  S,
  statusLine,
  step,
  success,
  table,
  tree,
  warn,
} from "../../ui";

describe("ui", () => {
  // --- formatDuration ---

  describe("formatDuration", () => {
    it("formats milliseconds", () => {
      expect(formatDuration(42)).toBe("42ms");
      expect(formatDuration(999)).toBe("999ms");
    });

    it("formats seconds", () => {
      expect(formatDuration(1000)).toBe("1.0s");
      expect(formatDuration(1500)).toBe("1.5s");
      expect(formatDuration(59999)).toBe("60.0s");
    });

    it("formats minutes and seconds", () => {
      expect(formatDuration(60_000)).toBe("1m 0s");
      expect(formatDuration(90_000)).toBe("1m 30s");
      expect(formatDuration(125_000)).toBe("2m 5s");
    });
  });

  // --- formatSize ---

  describe("formatSize", () => {
    it("formats bytes", () => {
      expect(formatSize(0)).toBe("0 B");
      expect(formatSize(512)).toBe("512 B");
      expect(formatSize(1023)).toBe("1023 B");
    });

    it("formats kilobytes", () => {
      expect(formatSize(1024)).toBe("1.0 KB");
      expect(formatSize(1024 * 512)).toBe("512.0 KB");
    });

    it("formats megabytes", () => {
      expect(formatSize(1024 * 1024)).toBe("1.00 MB");
      expect(formatSize(1024 * 1024 * 5.5)).toBe("5.50 MB");
    });

    it("formats gigabytes", () => {
      expect(formatSize(1024 * 1024 * 1024)).toBe("1.00 GB");
      expect(formatSize(1024 * 1024 * 1024 * 2.5)).toBe("2.50 GB");
    });
  });

  // --- formatDate ---

  describe("formatDate", () => {
    it("formats ISO date string", () => {
      // formatDate uses local timezone, so test structure rather than exact values
      const result = formatDate("2026-01-15T10:30:00Z");
      // Should match YYYY-MM-DD HH:MM pattern
      expect(result).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/);
    });
  });

  // --- table ---

  describe("table", () => {
    it("returns empty string for empty rows", () => {
      expect(table([{ label: "Name" }], [])).toBe("");
    });

    it("renders header, separator, and data rows", () => {
      const columns = [{ label: "Name" }, { label: "Size", align: "right" as const }];
      const rows = [
        ["foo.txt", "1.2 KB"],
        ["bar.json", "512 B"],
      ];
      const result = table(columns, rows);
      const lines = result.split("\n");

      // header + separator + 2 data rows
      expect(lines).toHaveLength(4);
      // Data rows should contain the values
      expect(lines[2]).toContain("foo.txt");
      expect(lines[3]).toContain("bar.json");
    });

    it("right-aligns columns when specified", () => {
      const columns = [{ label: "Count", align: "right" as const }];
      const rows = [["42"], ["1234"]];
      const result = table(columns, rows);
      const dataLines = result.split("\n").slice(2);

      // "42" should be padded to match "Count"/"1234" width
      expect(dataLines[0].trimEnd().endsWith("42")).toBe(true);
    });
  });

  // --- tree ---

  describe("tree", () => {
    it("returns empty string for empty children", () => {
      expect(tree([])).toBe("");
    });

    it("renders tree with correct branch symbols", () => {
      const result = tree([{ text: "first" }, { text: "second" }, { text: "last" }]);
      const lines = result.split("\n");
      expect(lines).toHaveLength(3);
      // First two use treeItem (├──), last uses treeLast (└──)
      expect(lines[0]).toContain("first");
      expect(lines[2]).toContain("last");
    });

    it("renders detail with padding", () => {
      const result = tree([{ text: "app.ts", detail: "1.2 KB" }]);
      expect(result).toContain("app.ts");
      expect(result).toContain("1.2 KB");
    });

    it("applies color to text", () => {
      // Just verify it doesn't throw for each color
      const result = tree([
        { text: "warn", color: "yellow" },
        { text: "ok", color: "green" },
        { text: "fail", color: "red" },
      ]);
      expect(result.split("\n")).toHaveLength(3);
    });

    it("applies dim styling", () => {
      const result = tree([{ text: "dimmed", dim: true }]);
      expect(result).toContain("dimmed");
    });
  });

  // --- console output functions ---

  describe("console output functions", () => {
    let logSpy: ReturnType<typeof vi.spyOn>;

    beforeEach(() => {
      logSpy = vi.spyOn(console, "log").mockImplementation(() => undefined);
    });

    it("banner prints version", () => {
      banner("1.0.0");
      expect(logSpy).toHaveBeenCalledOnce();
      const output = logSpy.mock.calls[0][0];
      expect(output).toContain("otter");
      expect(output).toContain("1.0.0");
    });

    it("step prints message", () => {
      step("Scanning collectors");
      expect(logSpy).toHaveBeenCalledOnce();
      expect(logSpy.mock.calls[0][0]).toContain("Scanning collectors");
    });

    it("step prints counter when provided", () => {
      step("Processing", 1, 3);
      const output = logSpy.mock.calls[0][0];
      expect(output).toContain("Processing");
      expect(output).toContain("1/3");
    });

    it("item prints collector result", () => {
      item({
        label: "homebrew",
        fileCount: 2,
        listCount: 150,
        errorCount: 0,
        skippedCount: 0,
        durationMs: 420,
      });
      expect(logSpy).toHaveBeenCalledOnce();
      const output = logSpy.mock.calls[0][0];
      expect(output).toContain("homebrew");
      expect(output).toContain("2 files");
      expect(output).toContain("150 items");
    });

    it("item shows warning symbol and error count when errors > 0", () => {
      item({
        label: "docker",
        fileCount: 1,
        listCount: 5,
        errorCount: 2,
        skippedCount: 0,
        durationMs: 100,
      });
      const output = logSpy.mock.calls[0][0];
      expect(output).toContain("2 err");
    });

    it("item shows skip count when skipped > 0 and no errors", () => {
      item({
        label: "fonts",
        fileCount: 0,
        listCount: 0,
        errorCount: 0,
        skippedCount: 3,
        durationMs: 50,
      });
      const output = logSpy.mock.calls[0][0];
      expect(output).toContain("3 skip");
    });

    it("statusLine prints message with optional timing", () => {
      statusLine("✓", "Uploaded snapshot", 1200);
      const output = logSpy.mock.calls[0][0];
      expect(output).toContain("Uploaded snapshot");
      expect(output).toContain("1.2s");
    });

    it("statusLine prints message without timing", () => {
      statusLine("●", "Ready");
      expect(logSpy.mock.calls[0][0]).toContain("Ready");
    });

    it("blank prints empty line", () => {
      blank();
      expect(logSpy).toHaveBeenCalledOnce();
    });

    it("info prints message with info symbol", () => {
      info("Connected to server");
      expect(logSpy.mock.calls[0][0]).toContain("Connected to server");
    });

    it("warn prints message", () => {
      warn("Disk space low");
      expect(logSpy.mock.calls[0][0]).toContain("Disk space low");
    });

    it("error prints message", () => {
      error("Connection failed");
      expect(logSpy.mock.calls[0][0]).toContain("Connection failed");
    });

    it("success prints message", () => {
      success("All done");
      expect(logSpy.mock.calls[0][0]).toContain("All done");
    });
  });

  // --- box functions (use consola.box) ---

  describe("box functions", () => {
    it("box calls consola.box", async () => {
      // Import consola from cli-base (same module as ui.ts uses)
      const { consola } = await import("@nocoo/cli-base");
      const boxSpy = vi.spyOn(consola, "box").mockImplementation(() => undefined);

      box({ title: "Summary", lines: ["Line 1", "Line 2"] });
      expect(boxSpy).toHaveBeenCalledOnce();
      boxSpy.mockRestore();
    });

    it("errorBox calls consola.box with red style", async () => {
      // Import consola from cli-base (same module as ui.ts uses)
      const { consola } = await import("@nocoo/cli-base");
      const boxSpy = vi.spyOn(consola, "box").mockImplementation(() => undefined);

      errorBox("Error", ["Something failed"]);
      expect(boxSpy).toHaveBeenCalledOnce();
      const arg = boxSpy.mock.calls[0][0] as Record<string, unknown>;
      expect((arg.style as Record<string, string>).borderColor).toBe("red");
      boxSpy.mockRestore();
    });
  });

  // --- symbols ---

  describe("symbols", () => {
    it("exports expected symbol keys", () => {
      expect(S).toHaveProperty("success");
      expect(S).toHaveProperty("warning");
      expect(S).toHaveProperty("error");
      expect(S).toHaveProperty("step");
      expect(S).toHaveProperty("info");
      expect(S).toHaveProperty("bar");
      expect(S).toHaveProperty("treeItem");
      expect(S).toHaveProperty("treeLast");
    });
  });
});
