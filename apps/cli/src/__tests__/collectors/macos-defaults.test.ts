import { describe, expect, it } from "vitest";
import { MacOSDefaultsCollector } from "../../collectors/macos-defaults.js";

describe("MacOSDefaultsCollector", () => {
  it("should collect defaults domains and login items", async () => {
    const collector = new MacOSDefaultsCollector("/fake/home");
    collector._execCommand = async (cmd: string) => {
      if (cmd.startsWith("defaults export")) {
        return '<?xml version="1.0"?><plist></plist>\n';
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

  it("records errors for failing defaults domains and swallows osascript failures", async () => {
    const collector = new MacOSDefaultsCollector("/fake/home");
    collector._execCommand = async (cmd: string) => {
      if (cmd.startsWith("defaults export")) throw new Error("not permitted");
      if (cmd.startsWith("osascript")) throw new Error("headless: no system events");
      return "";
    };

    const result = await collector.collect();

    expect(result.files).toHaveLength(0);
    expect(result.errors.length).toBeGreaterThan(0);
    expect(result.errors[0]).toContain("Failed to export defaults domain");
    expect(result.lists).toHaveLength(0);
  });
});
