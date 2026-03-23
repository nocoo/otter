import { describe, expect, it } from "vitest";
import { HomebrewCollector } from "../../collectors/homebrew.js";

describe("HomebrewCollector", () => {
  it("should have correct metadata", () => {
    const collector = new HomebrewCollector("/fake/home");
    expect(collector.id).toBe("homebrew");
    expect(collector.label).toBe("Homebrew Packages");
    expect(collector.category).toBe("environment");
  });

  it("should parse formula versions into list items", async () => {
    const collector = new HomebrewCollector("/fake/home");
    collector._execCommand = async (cmd: string) => {
      if (cmd === "brew list --formula --versions") {
        return "git 2.49.0\nnode 24.5.0\nripgrep 14.1.1\nfd 10.2.0\n";
      }
      if (cmd === "brew list --cask --versions") return "";
      if (cmd === "brew tap") return "";
      if (cmd === "brew list --pinned") return "";
      return "";
    };

    const result = await collector.collect();

    expect(result.lists).toContainEqual(
      expect.objectContaining({ name: "git", version: "2.49.0" }),
    );
    expect(result.lists).toContainEqual(
      expect.objectContaining({ name: "node", version: "24.5.0" }),
    );
    expect(result.lists).toContainEqual(
      expect.objectContaining({ name: "ripgrep", version: "14.1.1" }),
    );
    expect(result.lists.length).toBe(4);
  });

  it("should include casks, taps, and pinned metadata", async () => {
    const collector = new HomebrewCollector("/fake/home");
    collector._execCommand = async (cmd: string) => {
      if (cmd === "brew list --formula --versions") return "git 2.49.0\nnode 24.5.0\n";
      if (cmd === "brew list --cask --versions") {
        return "visual-studio-code 1.99.3\nfigma 125.4.8\n";
      }
      if (cmd === "brew tap") return "homebrew/cask\noven-sh/bun\n";
      if (cmd === "brew list --pinned") return "node\n";
      return "";
    };

    const result = await collector.collect();

    const formulae = result.lists.filter((l) => l.meta?.type === "formula");
    const casks = result.lists.filter((l) => l.meta?.type === "cask");
    const taps = result.lists.filter((l) => l.meta?.type === "tap");

    expect(formulae.length).toBe(2);
    expect(casks.length).toBe(2);
    expect(taps.length).toBe(2);
    expect(casks).toContainEqual(
      expect.objectContaining({ name: "visual-studio-code", version: "1.99.3" }),
    );
    expect(formulae).toContainEqual(
      expect.objectContaining({
        name: "node",
        version: "24.5.0",
        meta: { type: "formula", pinned: "true" },
      }),
    );
  });

  it("should handle missing homebrew gracefully", async () => {
    const collector = new HomebrewCollector("/fake/home");
    collector._execCommand = async () => {
      throw new Error("command not found: brew");
    };

    const result = await collector.collect();

    expect(result.lists).toHaveLength(0);
    expect(result.errors).toContainEqual(expect.stringContaining("command not found"));
  });

  it("should keep multiple installed versions in version field", async () => {
    const collector = new HomebrewCollector("/fake/home");
    collector._execCommand = async (cmd: string) => {
      if (cmd === "brew list --formula --versions") {
        return "python 3.12.1 3.11.7\n";
      }
      if (cmd === "brew list --cask --versions") return "";
      if (cmd === "brew tap") return "";
      if (cmd === "brew list --pinned") return "";
      return "";
    };

    const result = await collector.collect();

    expect(result.lists).toEqual([
      {
        name: "python",
        version: "3.12.1 3.11.7",
        meta: { type: "formula" },
      },
    ]);
  });

  it("should record pinned command failures without failing collection", async () => {
    const collector = new HomebrewCollector("/fake/home");
    collector._execCommand = async (cmd: string) => {
      if (cmd === "brew list --formula --versions") return "git 2.49.0\n";
      if (cmd === "brew list --cask --versions") return "";
      if (cmd === "brew tap") return "";
      if (cmd === "brew list --pinned") throw new Error("pinned unsupported");
      return "";
    };

    const result = await collector.collect();

    expect(result.lists).toHaveLength(1);
    expect(result.errors).toContainEqual(expect.stringContaining("brew list --pinned"));
  });
});
