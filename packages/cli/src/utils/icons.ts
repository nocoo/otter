import { execFile } from "node:child_process";
import type { Dirent } from "node:fs";
import { access, mkdir, readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

/** Result of extracting a single app icon */
export interface IconExportResult {
  /** App name (without .app) */
  appName: string;
  /** Whether the icon was exported successfully */
  success: boolean;
  /** Output PNG path (when successful) */
  outputPath?: string;
  /** Error message (when failed) */
  error?: string;
}

/** Options for the export-icons operation */
export interface ExportIconsOptions {
  /** Applications directory (default: /Applications) */
  appsDir?: string;
  /** Output directory for PNG icons */
  outputDir: string;
  /** Icon width in pixels (default: 128) */
  size?: number;
  /** Called after each icon is processed */
  onProgress?: (result: IconExportResult) => void;
}

/**
 * Extract CFBundleIconFile from an XML Info.plist.
 * Uses simple regex to avoid needing an XML parser dependency.
 * Exported for testing.
 */
export function extractIconFileName(plistContent: string): string | null {
  // Match <key>CFBundleIconFile</key> followed by <string>value</string>
  const pattern = /<key>CFBundleIconFile<\/key>\s*<string>([^<]+)<\/string>/i;
  const match = plistContent.match(pattern);
  if (!match) return null;

  let iconFile = match[1].trim();
  // Ensure .icns extension (some plists omit it)
  if (!iconFile.endsWith(".icns")) {
    iconFile += ".icns";
  }
  return iconFile;
}

function extractIconCandidates(plistContent: string): string[] {
  const keys = ["CFBundleIconFile", "CFBundleIconName"];
  const candidates: string[] = [];

  for (const key of keys) {
    const pattern = new RegExp(`<key>${key}<\\/key>\\s*<string>([^<]+)<\\/string>`, "i");
    const match = plistContent.match(pattern);
    if (!match) continue;

    let iconFile = match[1].trim();
    if (!iconFile.endsWith(".icns")) {
      iconFile += ".icns";
    }
    candidates.push(iconFile);
  }

  return [...new Set(candidates)];
}

async function readPlistAsXml(plistPath: string): Promise<string | null> {
  try {
    const { stdout } = await execFileAsync("/usr/bin/plutil", [
      "-convert",
      "xml1",
      "-o",
      "-",
      plistPath,
    ]);
    if (stdout) {
      return stdout;
    }
  } catch {
    // Fall back to direct read below.
  }

  try {
    return await readFile(plistPath, "utf-8");
  } catch {
    return null;
  }
}

/**
 * Resolve the .icns file path for a given .app bundle.
 * Returns null if the icon cannot be found.
 */
async function resolveIconPath(appPath: string): Promise<string | null> {
  const plistPath = join(appPath, "Contents", "Info.plist");

  try {
    const plistContent = await readPlistAsXml(plistPath);
    if (!plistContent) return null;

    for (const iconFile of extractIconCandidates(plistContent)) {
      const iconPath = join(appPath, "Contents", "Resources", iconFile);
      try {
        await access(iconPath);
        return iconPath;
      } catch {
        /* file not accessible, try next candidate */
      }
    }

    const fallback = extractIconFileName(plistContent);
    if (fallback) {
      const iconPath = join(appPath, "Contents", "Resources", fallback);
      await access(iconPath);
      return iconPath;
    }

    return null;
  } catch {
    return null;
  }
}

/**
 * Convert a .icns file to .png using macOS built-in sips.
 * Returns the output path on success, or throws on failure.
 */
async function convertIcnsToPng(icnsPath: string, outputPath: string, size: number): Promise<void> {
  await execFileAsync("/usr/bin/sips", [
    "-s",
    "format",
    "png",
    "--resampleWidth",
    String(size),
    icnsPath,
    "--out",
    outputPath,
  ]);
}

/**
 * Export app icons from /Applications as PNG files to a target directory.
 * Uses macOS `sips` for conversion (no external dependencies).
 */
export async function exportIcons(options: ExportIconsOptions): Promise<IconExportResult[]> {
  const { appsDir = "/Applications", outputDir, size = 128, onProgress } = options;

  // Ensure output directory exists
  await mkdir(outputDir, { recursive: true });

  const results: IconExportResult[] = [];

  let entries: Dirent[];
  try {
    entries = (await readdir(appsDir, { withFileTypes: true })) as Dirent[];
  } catch {
    return results;
  }

  const apps = entries.filter((e) => e.isDirectory() && e.name.endsWith(".app"));

  for (const app of apps) {
    const appName = app.name.replace(/\.app$/, "");
    const appPath = join(appsDir, app.name);

    const icnsPath = await resolveIconPath(appPath);
    if (!icnsPath) {
      const result: IconExportResult = {
        appName,
        success: false,
        error: "No icon found in Info.plist",
      };
      results.push(result);
      onProgress?.(result);
      continue;
    }

    const outputPath = join(outputDir, `${appName}.png`);
    try {
      await convertIcnsToPng(icnsPath, outputPath, size);
      const result: IconExportResult = {
        appName,
        success: true,
        outputPath,
      };
      results.push(result);
      onProgress?.(result);
    } catch (err) {
      const result: IconExportResult = {
        appName,
        success: false,
        error: `sips conversion failed: ${(err as Error).message}`,
      };
      results.push(result);
      onProgress?.(result);
    }
  }

  return results;
}
