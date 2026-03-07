import { describe, it, expect } from "vitest";
import { MacOSDefaultsCollector } from "../../collectors/macos-defaults.js";

describe("MacOSDefaultsCollector", () => {
  it("should collect defaults domains and login items", async () => {
    const collector = new MacOSDefaultsCollector("/fake/home");
    collector._execCommand = async (cmd: string) => {
      if (cmd.startsWith("defaults export")) {
        return "<?xml version=\"1.0\"?><plist></plist>\n";
      }
      if (cmd.startsWith("osascript")) {
        return "Raycast, CleanShot X\n";
      }
      return "";
    };

    const result = await collector.collect();

    expect(result.files.length).toBe(7);
    expect(result.files[0].path).toBe("macos-defaults/com.apple.dock.plist");
    expect(result.lists).toEqual([
      { name: "Raycast", meta: { type: "login-item" } },
      { name: "CleanShot X", meta: { type: "login-item" } },
    ]);
  });
});
