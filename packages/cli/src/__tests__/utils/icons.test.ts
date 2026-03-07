import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtemp, writeFile, mkdir, rm, readdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const mockExecFile = vi.fn(
  (
    cmd: string,
    _args: string[],
    cb: (err: Error | null, stdout: string, stderr: string) => void
  ) => {
    if (cmd === "/usr/bin/sips") {
      cb(null, "", "");
      return;
    }
    if (cmd === "/usr/bin/plutil") {
      cb(new Error("unexpected plutil call"), "", "");
      return;
    }
    cb(new Error(`unexpected command: ${cmd}`), "", "");
  }
);

vi.mock("node:child_process", () => ({
  execFile: mockExecFile,
}));

describe("extractIconFileName", async () => {
  const { extractIconFileName } = await import("../../utils/icons.js");

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

  it("should still extract icon file when plist also contains CFBundleIconName", () => {
    const plist = `<?xml version="1.0"?>
<plist><dict>
  <key>CFBundleIconName</key>
  <string>Xcode</string>
  <key>CFBundleIconFile</key>
  <string>Xcode</string>
</dict></plist>`;
    expect(extractIconFileName(plist)).toBe("Xcode.icns");
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

describe("exportIcons", async () => {
  const { exportIcons } = await import("../../utils/icons.js");

  let tempDir: string;
  let appsDir: string;
  let outputDir: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "otter-icons-test-"));
    appsDir = join(tempDir, "Applications");
    outputDir = join(tempDir, "output");
    await mkdir(appsDir, { recursive: true });
    mockExecFile.mockReset();
    mockExecFile.mockImplementation(
      (
        cmd: string,
        _args: string[],
        cb: (err: Error | null, stdout: string, stderr: string) => void
      ) => {
        if (cmd === "/usr/bin/sips") {
          cb(null, "", "");
          return;
        }
        if (cmd === "/usr/bin/plutil") {
          cb(new Error("unexpected plutil call"), "", "");
          return;
        }
        cb(new Error(`unexpected command: ${cmd}`), "", "");
      }
    );
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

  it("should successfully export icon when plist and icns file exist", async () => {
    const appPath = join(appsDir, "GoodApp.app");
    await mkdir(join(appPath, "Contents", "Resources"), { recursive: true });
    await writeFile(
      join(appPath, "Contents", "Info.plist"),
      `<?xml version="1.0"?>
<plist><dict>
  <key>CFBundleIconFile</key>
  <string>AppIcon</string>
</dict></plist>`
    );
    await writeFile(
      join(appPath, "Contents", "Resources", "AppIcon.icns"),
      "fake-icns-data"
    );

    const results = await exportIcons({ appsDir, outputDir });
    expect(results).toHaveLength(1);
    expect(results[0]).toMatchObject({
      appName: "GoodApp",
      success: true,
      outputPath: join(outputDir, "GoodApp.png"),
    });
  });

  it("should report sips conversion failure", async () => {
    mockExecFile.mockImplementation(
      (cmd: string, _args: string[], cb: (err: Error | null, stdout: string, stderr: string) => void) => {
        if (cmd === "/usr/bin/plutil") {
          cb(new Error("unexpected plutil call"), "", "");
          return;
        }
        cb(new Error("sips: could not convert"), "", "");
      }
    );

    const appPath = join(appsDir, "BrokenApp.app");
    await mkdir(join(appPath, "Contents", "Resources"), { recursive: true });
    await writeFile(
      join(appPath, "Contents", "Info.plist"),
      `<?xml version="1.0"?>
<plist><dict>
  <key>CFBundleIconFile</key>
  <string>BrokenIcon.icns</string>
</dict></plist>`
    );
    await writeFile(
      join(appPath, "Contents", "Resources", "BrokenIcon.icns"),
      "corrupted-data"
    );

    const results = await exportIcons({ appsDir, outputDir });
    expect(results).toHaveLength(1);
    expect(results[0]).toMatchObject({
      appName: "BrokenApp",
      success: false,
    });
    expect(results[0].error).toContain("sips conversion failed");
  });

  it("should call onProgress with success result for valid icon", async () => {
    const appPath = join(appsDir, "ProgressApp.app");
    await mkdir(join(appPath, "Contents", "Resources"), { recursive: true });
    await writeFile(
      join(appPath, "Contents", "Info.plist"),
      `<?xml version="1.0"?>
<plist><dict>
  <key>CFBundleIconFile</key>
  <string>Icon.icns</string>
</dict></plist>`
    );
    await writeFile(
      join(appPath, "Contents", "Resources", "Icon.icns"),
      "icns-data"
    );

    const progressResults: Array<{ appName: string; success: boolean }> = [];
    await exportIcons({
      appsDir,
      outputDir,
      onProgress: (r) => progressResults.push({ appName: r.appName, success: r.success }),
    });

    expect(progressResults).toHaveLength(1);
    expect(progressResults[0]).toEqual({ appName: "ProgressApp", success: true });
  });
});
