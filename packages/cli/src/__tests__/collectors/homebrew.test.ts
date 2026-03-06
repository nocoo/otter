import { describe, it, expect, vi, beforeEach } from "vitest";
import { HomebrewCollector } from "../../collectors/homebrew.js";

describe("HomebrewCollector", () => {
  it("should have correct metadata", () => {
    const collector = new HomebrewCollector("/fake/home");
    expect(collector.id).toBe("homebrew");
    expect(collector.label).toBe("Homebrew Packages");
    expect(collector.category).toBe("environment");
  });

  it("should parse brew list output into list items", async () => {
    const collector = new HomebrewCollector("/fake/home");
    collector._execCommand = async (cmd: string) => {
      if (cmd.includes("--cask")) return "";
      return "git\nnode\nripgrep\nfd\n";
    };

    const result = await collector.collect();

    expect(result.lists).toContainEqual(
      expect.objectContaining({ name: "git" })
    );
    expect(result.lists).toContainEqual(
      expect.objectContaining({ name: "node" })
    );
    expect(result.lists).toContainEqual(
      expect.objectContaining({ name: "ripgrep" })
    );
    expect(result.lists.length).toBe(4);
  });

  it("should include cask packages separately", async () => {
    const collector = new HomebrewCollector("/fake/home");
    let callCount = 0;
    collector._execCommand = async (cmd: string) => {
      callCount++;
      if (cmd.includes("--cask")) return "visual-studio-code\nfigma\n";
      return "git\nnode\n";
    };

    const result = await collector.collect();

    const formulae = result.lists.filter((l) => l.meta?.type === "formula");
    const casks = result.lists.filter((l) => l.meta?.type === "cask");

    expect(formulae.length).toBe(2);
    expect(casks.length).toBe(2);
    expect(casks).toContainEqual(
      expect.objectContaining({ name: "visual-studio-code" })
    );
  });

  it("should handle missing homebrew gracefully", async () => {
    const collector = new HomebrewCollector("/fake/home");
    collector._execCommand = async () => {
      throw new Error("command not found: brew");
    };

    const result = await collector.collect();

    expect(result.lists).toHaveLength(0);
    expect(result.errors).toContainEqual(
      expect.stringContaining("command not found")
    );
  });

  it("should filter empty lines from output", async () => {
    const collector = new HomebrewCollector("/fake/home");
    collector._execCommand = async (cmd: string) => {
      if (cmd.includes("--cask")) return "";
      return "git\n\n\nnode\n\n";
    };

    const result = await collector.collect();

    expect(result.lists.length).toBe(2);
  });
});
