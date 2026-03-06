import { readFile, readdir, stat } from "node:fs/promises";
import { join, extname, basename } from "node:path";
import type {
  Collector,
  CollectorCategory,
  CollectorResult,
  CollectedFile,
} from "@otter/core";

// ---------------------------------------------------------------------------
// Constants for safety limits
// ---------------------------------------------------------------------------

/** Maximum size (in bytes) for a single file to be collected (512 KB) */
const MAX_FILE_SIZE_BYTES = 512 * 1024;

/** Directory names that should always be skipped during recursive collection */
const EXCLUDED_DIRS = new Set([
  ".git",
  "node_modules",
  "__pycache__",
  ".cache",
  "cache",
  "target",
  "build",
  "dist",
  ".next",
  ".nuxt",
  ".turbo",
]);

/** File extensions that indicate binary / non-text content */
const BINARY_EXTENSIONS = new Set([
  ".ds_store",
  ".sqlite",
  ".sqlite3",
  ".db",
  ".wasm",
  ".dylib",
  ".so",
  ".dll",
  ".exe",
  ".o",
  ".a",
  ".ico",
  ".png",
  ".jpg",
  ".jpeg",
  ".gif",
  ".webp",
  ".bmp",
  ".tiff",
  ".mp3",
  ".mp4",
  ".mov",
  ".avi",
  ".zip",
  ".tar",
  ".gz",
  ".bz2",
  ".xz",
  ".7z",
  ".rar",
  ".pdf",
  ".ttf",
  ".otf",
  ".woff",
  ".woff2",
  ".eot",
]);

/** File basenames that are always binary regardless of extension */
const BINARY_BASENAMES = new Set([".ds_store", "thumbs.db", "desktop.ini"]);

/** Options for collectDir to allow per-call customization */
export interface CollectDirOptions {
  /** Custom filter — return false to skip a file */
  filter?: (filePath: string) => boolean;
  /** Override the default max file size (bytes) */
  maxFileSize?: number;
  /** Additional directory names to exclude */
  excludeDirs?: Set<string>;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Check if a file is likely binary based on its name / extension */
function isBinaryFile(fileName: string): boolean {
  const lower = fileName.toLowerCase();
  if (BINARY_BASENAMES.has(lower)) return true;
  const ext = extname(lower);
  return ext !== "" && BINARY_EXTENSIONS.has(ext);
}

/**
 * Base class for all collectors. Provides common file reading utilities
 * and standardized result creation.
 */
export abstract class BaseCollector implements Collector {
  abstract readonly id: string;
  abstract readonly label: string;
  abstract readonly category: CollectorCategory;

  constructor(protected readonly homeDir: string) {}

  abstract collect(): Promise<CollectorResult>;

  /** Create an empty result skeleton */
  protected createResult(): CollectorResult {
    return {
      id: this.id,
      label: this.label,
      category: this.category,
      files: [],
      lists: [],
      errors: [],
      durationMs: 0,
    };
  }

  /**
   * Safely read a single file. Returns null if file doesn't exist,
   * can't be read, exceeds size limit, or is binary.
   */
  protected async safeReadFile(
    filePath: string,
    result: CollectorResult,
    maxSize: number = MAX_FILE_SIZE_BYTES
  ): Promise<CollectedFile | null> {
    try {
      // Skip binary files
      const fileName = basename(filePath);
      if (isBinaryFile(fileName)) return null;

      const info = await stat(filePath);

      // Skip files exceeding size limit
      if (info.size > maxSize) {
        result.errors.push(
          `Skipped ${filePath}: exceeds size limit (${(info.size / 1024).toFixed(0)} KB > ${(maxSize / 1024).toFixed(0)} KB)`
        );
        return null;
      }

      const content = await readFile(filePath, "utf-8");
      return {
        path: filePath,
        content,
        sizeBytes: info.size,
      };
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== "ENOENT") {
        result.errors.push(
          `Failed to read ${filePath}: ${(err as Error).message}`
        );
      }
      return null;
    }
  }

  /**
   * Recursively collect all files in a directory.
   *
   * Safety features:
   *  - Skips excluded directories (.git, node_modules, cache, build output, etc.)
   *  - Skips binary files (by extension and known basenames)
   *  - Skips files exceeding size limit (default 512 KB)
   */
  protected async collectDir(
    dirPath: string,
    result: CollectorResult,
    opts: CollectDirOptions = {}
  ): Promise<CollectedFile[]> {
    const { filter, maxFileSize = MAX_FILE_SIZE_BYTES, excludeDirs } = opts;
    const files: CollectedFile[] = [];
    try {
      const entries = await readdir(dirPath, { withFileTypes: true });
      for (const entry of entries) {
        const fullPath = join(dirPath, entry.name);

        if (entry.isDirectory()) {
          const dirName = entry.name.toLowerCase();
          // Skip globally excluded directories
          if (EXCLUDED_DIRS.has(dirName)) continue;
          // Skip caller-specified excluded directories
          if (excludeDirs?.has(dirName)) continue;

          const subFiles = await this.collectDir(fullPath, result, opts);
          files.push(...subFiles);
        } else if (entry.isFile()) {
          if (filter && !filter(fullPath)) continue;
          const file = await this.safeReadFile(fullPath, result, maxFileSize);
          if (file) files.push(file);
        }
      }
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== "ENOENT") {
        result.errors.push(
          `Failed to read directory ${dirPath}: ${(err as Error).message}`
        );
      }
    }
    return files;
  }

  /** Measure execution time of the collect operation */
  protected async timed(
    fn: (result: CollectorResult) => Promise<void>
  ): Promise<CollectorResult> {
    const result = this.createResult();
    const start = performance.now();
    await fn(result);
    result.durationMs = Math.round(performance.now() - start);
    return result;
  }
}
