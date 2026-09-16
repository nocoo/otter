import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { LaunchAgentsCollector } from "../../collectors/launch-agents.js";

describe("LaunchAgentsCollector", () => {
  let tempHome: string;

  beforeEach(async () => {
    tempHome = await mkdtemp(join(tmpdir(), "otter-launch-agents-test-"));
    await mkdir(join(tempHome, "Library", "LaunchAgents"), { recursive: true });
  });

  afterEach(async () => {
    await rm(tempHome, { recursive: true, force: true });
  });

  it("should collect launch agents and crontab", async () => {
    await writeFile(join(tempHome, "Library", "LaunchAgents", "com.example.sync.plist"), "plist");

    const collector = new LaunchAgentsCollector(tempHome);
    collector._execCommand = async () => "MAILTO=user@example.com\n0 1 * * * backup\n";

    const result = await collector.collect();

    expect(result.lists).toEqual([
      { name: "com.example.sync.plist", meta: { type: "user-agent" } },
    ]);
    expect(result.files[0].path).toBe("crontab");
    expect(result.files[0].content).toContain("MAILTO");
  });

  it("swallows crontab failures (no crontab configured)", async () => {
    const collector = new LaunchAgentsCollector(tempHome);
    collector._execCommand = async () => {
      throw new Error("crontab: no crontab for user");
    };

    const result = await collector.collect();

    expect(result.files).toHaveLength(0);
    expect(result.errors).toHaveLength(0);
  });

  it("ignores empty crontab output", async () => {
    const collector = new LaunchAgentsCollector(tempHome);
    collector._execCommand = async () => "   \n";

    const result = await collector.collect();

    expect(result.files).toHaveLength(0);
  });

  it("records non-ENOENT errors when reading launch agents dir fails", async () => {
    const collector = new LaunchAgentsCollector("/nonexistent/path/that/is/not/enoent");
    collector._execCommand = async () => "";
    const result = await collector.collect();
    expect(result.errors.some((e) => e.includes("Failed to read launch agents"))).toBe(false);
  });
});
