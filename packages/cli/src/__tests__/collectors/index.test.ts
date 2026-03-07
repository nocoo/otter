import { describe, it, expect } from "vitest";
import { createDefaultCollectors } from "../../collectors/index.js";

describe("createDefaultCollectors", () => {
  it("should include P0, P1, and P2 collectors", () => {
    const collectors = createDefaultCollectors("/fake/home", {
      iconBaseUrl: "https://cdn.example.com/icons",
    });

    expect(collectors.map((collector) => collector.id)).toEqual([
      "claude-config",
      "opencode-config",
      "shell-config",
      "homebrew",
      "applications",
      "vscode",
      "docker",
      "fonts",
      "dev-toolchain",
      "cloud-cli",
      "macos-defaults",
      "launch-agents",
    ]);
  });
});
