import { createHash } from "node:crypto";
import { chmod, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ApplicationsCollector } from "../../collectors/applications.js";

describe("ApplicationsCollector", () => {
  let tempHome: string;
  let tempAppsDir: string;
  let tempUserAppsDir: string;

  beforeEach(async () => {
    tempHome = await mkdtemp(join(tmpdir(), "otter-test-"));
    tempAppsDir = join(tempHome, "Applications");
    tempUserAppsDir = join(tempHome, "UserApplications");
    await mkdir(tempAppsDir, { recursive: true });
    await mkdir(tempUserAppsDir, { recursive: true });
  });

  afterEach(async () => {
    await rm(tempHome, { recursive: true, force: true });
  });

  it("should have correct metadata", () => {
    const collector = new ApplicationsCollector(tempHome, tempAppsDir, undefined, tempUserAppsDir);
    expect(collector.id).toBe("applications");
    expect(collector.label).toBe("Installed Applications");
    expect(collector.category).toBe("environment");
  });

  it("should list .app directories", async () => {
    await mkdir(join(tempAppsDir, "Safari.app"), { recursive: true });
    await mkdir(join(tempAppsDir, "Chrome.app"), { recursive: true });

    const collector = new ApplicationsCollector(tempHome, tempAppsDir, undefined, tempUserAppsDir);
    collector._execCommand = async () => "";
    const result = await collector.collect();

    const names = result.lists.map((l) => l.name);
    expect(names).toContain("Safari");
    expect(names).toContain("Chrome");
  });

  it("should only list .app entries, ignoring regular files", async () => {
    await mkdir(join(tempAppsDir, "Slack.app"), { recursive: true });
    await writeFile(join(tempAppsDir, "readme.txt"), "not an app");
    await mkdir(join(tempAppsDir, "NotAnApp"), { recursive: true });

    const collector = new ApplicationsCollector(tempHome, tempAppsDir, undefined, tempUserAppsDir);
    collector._execCommand = async () => "";
    const result = await collector.collect();

    expect(result.lists).toHaveLength(1);
    expect(result.lists[0].name).toBe("Slack");
  });

  it("should return empty list when no apps exist", async () => {
    const collector = new ApplicationsCollector(tempHome, tempAppsDir, undefined, tempUserAppsDir);
    collector._execCommand = async () => "";
    const result = await collector.collect();

    expect(result.lists).toHaveLength(0);
    expect(result.errors).toHaveLength(0);
  });

  it("should not include files array (list-only collector)", async () => {
    await mkdir(join(tempAppsDir, "VSCode.app"), { recursive: true });

    const collector = new ApplicationsCollector(tempHome, tempAppsDir, undefined, tempUserAppsDir);
    collector._execCommand = async () => "";
    const result = await collector.collect();

    expect(result.files).toHaveLength(0);
  });

  it("should handle missing applications directory", async () => {
    const collector = new ApplicationsCollector(
      tempHome,
      "/nonexistent/path",
      undefined,
      tempUserAppsDir,
    );
    collector._execCommand = async () => "";
    const result = await collector.collect();

    expect(result.lists).toHaveLength(0);
    expect(result.errors).toHaveLength(0);
  });

  it("should record error when directory read fails with non-ENOENT", async () => {
    // Remove read permissions from directory to trigger EACCES
    await chmod(tempAppsDir, 0o000);

    const collector = new ApplicationsCollector(tempHome, tempAppsDir, undefined, tempUserAppsDir);
    collector._execCommand = async () => "";
    const result = await collector.collect();

    expect(result.lists).toHaveLength(0);
    expect(result.errors).toEqual(
      expect.arrayContaining([
        expect.stringContaining(`Failed to read applications directory ${tempAppsDir}`),
      ]),
    );

    // Restore permissions for cleanup
    await chmod(tempAppsDir, 0o755);
  });

  describe("icon URL generation", () => {
    it("should include iconUrl in meta when iconBaseUrl is provided", async () => {
      await mkdir(join(tempAppsDir, "Slack.app"), { recursive: true });

      const collector = new ApplicationsCollector(
        tempHome,
        tempAppsDir,
        "https://s.zhe.to/apps/otter",
        tempUserAppsDir,
      );
      collector._execCommand = async () => "";
      const result = await collector.collect();

      const hash = createHash("sha256").update("Slack").digest("hex").slice(0, 12);
      expect(result.lists[0].meta).toEqual({
        iconUrl: `https://s.zhe.to/apps/otter/${hash}.png`,
      });
    });

    it("should not include meta when iconBaseUrl is omitted", async () => {
      await mkdir(join(tempAppsDir, "Slack.app"), { recursive: true });

      const collector = new ApplicationsCollector(
        tempHome,
        tempAppsDir,
        undefined,
        tempUserAppsDir,
      );
      collector._execCommand = async () => "";
      const result = await collector.collect();

      expect(result.lists[0].meta).toBeUndefined();
    });

    it("should generate deterministic URLs based on app name", async () => {
      await mkdir(join(tempAppsDir, "App1.app"), { recursive: true });
      await mkdir(join(tempAppsDir, "App2.app"), { recursive: true });

      const collector = new ApplicationsCollector(
        tempHome,
        tempAppsDir,
        "https://cdn.example.com/icons",
        tempUserAppsDir,
      );
      collector._execCommand = async () => "";
      const result = await collector.collect();

      // Each app should have a unique icon URL
      const urls = result.lists.map((l) => l.meta?.iconUrl);
      expect(new Set(urls).size).toBe(2);

      // URLs should follow the expected pattern
      for (const item of result.lists) {
        expect(item.meta?.iconUrl).toMatch(
          /^https:\/\/cdn\.example\.com\/icons\/[a-f0-9]{12}\.png$/,
        );
      }
    });
  });

  it("should merge system and user Applications directories", async () => {
    await mkdir(join(tempAppsDir, "Safari.app"), { recursive: true });
    await mkdir(join(tempUserAppsDir, "Cursor.app"), { recursive: true });

    const collector = new ApplicationsCollector(tempHome, tempAppsDir, undefined, tempUserAppsDir);
    collector._execCommand = async () => "";
    const result = await collector.collect();

    expect(result.lists.map((item) => item.name)).toEqual(["Cursor", "Safari"]);
  });

  it("should deduplicate apps that exist in both directories", async () => {
    await mkdir(join(tempAppsDir, "Slack.app"), { recursive: true });
    await mkdir(join(tempUserAppsDir, "Slack.app"), { recursive: true });

    const collector = new ApplicationsCollector(tempHome, tempAppsDir, undefined, tempUserAppsDir);
    collector._execCommand = async () => "";
    const result = await collector.collect();

    expect(result.lists).toHaveLength(1);
    expect(result.lists[0].name).toBe("Slack");
  });

  it("should capture app versions from Info.plist", async () => {
    await mkdir(join(tempAppsDir, "Docker.app", "Contents"), { recursive: true });

    const collector = new ApplicationsCollector(tempHome, tempAppsDir, undefined, tempUserAppsDir);
    collector._execCommand = async (cmd: string) => {
      expect(cmd).toContain("defaults read");
      expect(cmd).toContain("Docker.app/Contents/Info.plist");
      return "4.39.0\n";
    };

    const result = await collector.collect();

    expect(result.lists).toEqual([{ name: "Docker", version: "4.39.0" }]);
  });

  it("should ignore version lookup failures", async () => {
    await mkdir(join(tempAppsDir, "Docker.app", "Contents"), { recursive: true });

    const collector = new ApplicationsCollector(tempHome, tempAppsDir, undefined, tempUserAppsDir);
    collector._execCommand = async () => {
      throw new Error("missing plist key");
    };

    const result = await collector.collect();

    expect(result.lists).toEqual([{ name: "Docker" }]);
    expect(result.errors).toHaveLength(0);
  });
});
