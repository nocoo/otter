import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
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
    await writeFile(
      join(tempHome, "Library", "LaunchAgents", "com.example.sync.plist"),
      "plist"
    );

    const collector = new LaunchAgentsCollector(tempHome);
    collector._execCommand = async () => "MAILTO=user@example.com\n0 1 * * * backup\n";

    const result = await collector.collect();

    expect(result.lists).toEqual([
      { name: "com.example.sync.plist", meta: { type: "user-agent" } },
    ]);
    expect(result.files[0].path).toBe("crontab");
    expect(result.files[0].content).toContain("MAILTO");
  });
});
