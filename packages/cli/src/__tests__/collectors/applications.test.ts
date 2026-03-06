import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ApplicationsCollector } from "../../collectors/applications.js";

describe("ApplicationsCollector", () => {
  let tempHome: string;
  let tempAppsDir: string;

  beforeEach(async () => {
    tempHome = await mkdtemp(join(tmpdir(), "otter-test-"));
    tempAppsDir = join(tempHome, "Applications");
    await mkdir(tempAppsDir, { recursive: true });
  });

  afterEach(async () => {
    await rm(tempHome, { recursive: true, force: true });
  });

  it("should have correct metadata", () => {
    const collector = new ApplicationsCollector(tempHome, tempAppsDir);
    expect(collector.id).toBe("applications");
    expect(collector.label).toBe("Installed Applications");
    expect(collector.category).toBe("environment");
  });

  it("should list .app directories", async () => {
    await mkdir(join(tempAppsDir, "Safari.app"), { recursive: true });
    await mkdir(join(tempAppsDir, "Chrome.app"), { recursive: true });

    const collector = new ApplicationsCollector(tempHome, tempAppsDir);
    const result = await collector.collect();

    const names = result.lists.map((l) => l.name);
    expect(names).toContain("Safari");
    expect(names).toContain("Chrome");
  });

  it("should only list .app entries, ignoring regular files", async () => {
    await mkdir(join(tempAppsDir, "Slack.app"), { recursive: true });
    await writeFile(join(tempAppsDir, "readme.txt"), "not an app");
    await mkdir(join(tempAppsDir, "NotAnApp"), { recursive: true });

    const collector = new ApplicationsCollector(tempHome, tempAppsDir);
    const result = await collector.collect();

    expect(result.lists).toHaveLength(1);
    expect(result.lists[0].name).toBe("Slack");
  });

  it("should return empty list when no apps exist", async () => {
    const collector = new ApplicationsCollector(tempHome, tempAppsDir);
    const result = await collector.collect();

    expect(result.lists).toHaveLength(0);
    expect(result.errors).toHaveLength(0);
  });

  it("should not include files array (list-only collector)", async () => {
    await mkdir(join(tempAppsDir, "VSCode.app"), { recursive: true });

    const collector = new ApplicationsCollector(tempHome, tempAppsDir);
    const result = await collector.collect();

    expect(result.files).toHaveLength(0);
  });

  it("should handle missing applications directory", async () => {
    const collector = new ApplicationsCollector(tempHome, "/nonexistent/path");
    const result = await collector.collect();

    expect(result.lists).toHaveLength(0);
    expect(result.errors).toHaveLength(0);
  });
});
