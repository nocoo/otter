import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, writeFile, mkdir, rm, readdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { extractIconFileName, exportIcons } from "../../utils/icons.js";

describe("extractIconFileName", () => {
  it("should extract icon file from XML plist", () => {
    const plist = `<?xml version="1.0" encoding="UTF-8"?>
<plist version="1.0">
<dict>
  <key>CFBundleIconFile</key>
  <string>AppIcon</string>
  <key>CFBundleName</key>
  <string>MyApp</string>
</dict>
</plist>`;
    expect(extractIconFileName(plist)).toBe("AppIcon.icns");
  });

  it("should preserve .icns extension if already present", () => {
    const plist = `<?xml version="1.0"?>
<plist><dict>
  <key>CFBundleIconFile</key>
  <string>electron.icns</string>
</dict></plist>`;
    expect(extractIconFileName(plist)).toBe("electron.icns");
  });

  it("should return null when no CFBundleIconFile key", () => {
    const plist = `<?xml version="1.0"?>
<plist><dict>
  <key>CFBundleName</key>
  <string>MyApp</string>
</dict></plist>`;
    expect(extractIconFileName(plist)).toBeNull();
  });

  it("should return null for empty string", () => {
    expect(extractIconFileName("")).toBeNull();
  });

  it("should handle whitespace around icon filename", () => {
    const plist = `<plist><dict>
  <key>CFBundleIconFile</key>
  <string>  icon  </string>
</dict></plist>`;
    expect(extractIconFileName(plist)).toBe("icon.icns");
  });
});

describe("exportIcons", () => {
  let tempDir: string;
  let appsDir: string;
  let outputDir: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "otter-icons-test-"));
    appsDir = join(tempDir, "Applications");
    outputDir = join(tempDir, "output");
    await mkdir(appsDir, { recursive: true });
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  it("should return empty results when no apps exist", async () => {
    const results = await exportIcons({ appsDir, outputDir });
    expect(results).toHaveLength(0);
  });

  it("should return empty results when apps dir does not exist", async () => {
    const results = await exportIcons({
      appsDir: join(tempDir, "nonexistent"),
      outputDir,
    });
    expect(results).toHaveLength(0);
  });

  it("should create output directory", async () => {
    await exportIcons({ appsDir, outputDir });
    const entries = await readdir(outputDir);
    expect(entries).toBeDefined();
  });

  it("should report failure when app has no Info.plist", async () => {
    await mkdir(join(appsDir, "NoIcon.app", "Contents", "Resources"), {
      recursive: true,
    });

    const results = await exportIcons({ appsDir, outputDir });
    expect(results).toHaveLength(1);
    expect(results[0]).toMatchObject({
      appName: "NoIcon",
      success: false,
    });
  });

  it("should report failure when icon file is missing", async () => {
    const appPath = join(appsDir, "MissingIcon.app");
    await mkdir(join(appPath, "Contents", "Resources"), { recursive: true });
    await writeFile(
      join(appPath, "Contents", "Info.plist"),
      `<?xml version="1.0"?>
<plist><dict>
  <key>CFBundleIconFile</key>
  <string>missing.icns</string>
</dict></plist>`
    );

    const results = await exportIcons({ appsDir, outputDir });
    expect(results).toHaveLength(1);
    expect(results[0]).toMatchObject({
      appName: "MissingIcon",
      success: false,
    });
  });

  it("should call onProgress for each app", async () => {
    await mkdir(join(appsDir, "App1.app", "Contents", "Resources"), {
      recursive: true,
    });
    await mkdir(join(appsDir, "App2.app", "Contents", "Resources"), {
      recursive: true,
    });

    const progressCalls: string[] = [];
    await exportIcons({
      appsDir,
      outputDir,
      onProgress: (result) => progressCalls.push(result.appName),
    });

    expect(progressCalls).toContain("App1");
    expect(progressCalls).toContain("App2");
  });

  it("should skip non-.app directories", async () => {
    await mkdir(join(appsDir, "NotAnApp"), { recursive: true });
    await mkdir(join(appsDir, "readme.txt"), { recursive: true });

    const results = await exportIcons({ appsDir, outputDir });
    expect(results).toHaveLength(0);
  });
});
