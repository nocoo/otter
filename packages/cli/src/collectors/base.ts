import { readFile, readdir, stat } from "node:fs/promises";
import { join } from "node:path";
import type {
  Collector,
  CollectorCategory,
  CollectorResult,
  CollectedFile,
} from "@otter/core";

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
   * Safely read a single file. Returns null if file doesn't exist
   * or can't be read.
   */
  protected async safeReadFile(
    filePath: string,
    result: CollectorResult
  ): Promise<CollectedFile | null> {
    try {
      const content = await readFile(filePath, "utf-8");
      const info = await stat(filePath);
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
   * Recursively collect all files in a directory, with optional filtering.
   */
  protected async collectDir(
    dirPath: string,
    result: CollectorResult,
    filter?: (filePath: string) => boolean
  ): Promise<CollectedFile[]> {
    const files: CollectedFile[] = [];
    try {
      const entries = await readdir(dirPath, { withFileTypes: true });
      for (const entry of entries) {
        const fullPath = join(dirPath, entry.name);
        if (entry.isDirectory()) {
          const subFiles = await this.collectDir(fullPath, result, filter);
          files.push(...subFiles);
        } else if (entry.isFile()) {
          if (filter && !filter(fullPath)) continue;
          const file = await this.safeReadFile(fullPath, result);
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
