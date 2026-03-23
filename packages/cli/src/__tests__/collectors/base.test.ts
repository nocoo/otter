import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  mkdtemp,
  writeFile,
  mkdir,
  rm,
  chmod,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { CollectorCategory, CollectorResult } from "@otter/core";
import { BaseCollector } from "../../collectors/base.js";

/**
 * Concrete subclass to expose protected methods for testing.
 */
class TestCollector extends BaseCollector {
  readonly id = "test";
  readonly label = "Test Collector";
  readonly category: CollectorCategory = "config";

  async collect(): Promise<CollectorResult> {
    return this.timed(async () => { /* no-op — stub for testing */ });
  }

  // Expose protected methods for testing
  async testSafeReadFile(
    ...args: Parameters<BaseCollector["safeReadFile"]>
  ) {
    return this.safeReadFile(...args);
  }

  async testCollectDir(
    ...args: Parameters<BaseCollector["collectDir"]>
  ) {
    return this.collectDir(...args);
  }

  testCreateResult() {
    return this.createResult();
  }
}

describe("BaseCollector", () => {
  let tempDir: string;
  let collector: TestCollector;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "otter-base-test-"));
    collector = new TestCollector(tempDir);
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  describe("safeReadFile", () => {
    it("should read a text file successfully", async () => {
      const filePath = join(tempDir, "test.txt");
      await writeFile(filePath, "hello world");

      const result = collector.testCreateResult();
      const file = await collector.testSafeReadFile(filePath, result);

      expect(file).not.toBeNull();
      // biome-ignore lint/style/noNonNullAssertion: asserted non-null above
      expect(file!.content).toBe("hello world");
      // biome-ignore lint/style/noNonNullAssertion: asserted non-null above
      expect(file!.path).toBe(filePath);
      expect(result.errors).toHaveLength(0);
    });

    it("should return null for binary files", async () => {
      const filePath = join(tempDir, "image.png");
      await writeFile(filePath, "fake-png");

      const result = collector.testCreateResult();
      const file = await collector.testSafeReadFile(filePath, result);

      expect(file).toBeNull();
      expect(result.errors).toHaveLength(0);
    });

    it("should return null for .DS_Store files", async () => {
      const filePath = join(tempDir, ".DS_Store");
      await writeFile(filePath, "binary-data");

      const result = collector.testCreateResult();
      const file = await collector.testSafeReadFile(filePath, result);

      expect(file).toBeNull();
    });

    it("should skip files exceeding size limit", async () => {
      const filePath = join(tempDir, "large.txt");
      await writeFile(filePath, "x".repeat(1000));

      const result = collector.testCreateResult();
      const file = await collector.testSafeReadFile(filePath, result, {
        maxSize: 100,
      });

      expect(file).toBeNull();
      expect(result.errors).toHaveLength(1);
      expect(result.errors[0]).toContain("exceeds size limit");
    });

    it("should return null silently for missing files (ENOENT)", async () => {
      const result = collector.testCreateResult();
      const file = await collector.testSafeReadFile(
        join(tempDir, "nonexistent.txt"),
        result
      );

      expect(file).toBeNull();
      expect(result.errors).toHaveLength(0);
    });

    it("should record non-ENOENT errors", async () => {
      // Create a file, then remove read permissions to trigger EACCES
      const filePath = join(tempDir, "noperm.txt");
      await writeFile(filePath, "secret");
      await chmod(filePath, 0o000);

      const result = collector.testCreateResult();
      const file = await collector.testSafeReadFile(filePath, result);

      expect(file).toBeNull();
      expect(result.errors).toHaveLength(1);
      expect(result.errors[0]).toContain("Failed to read");

      // Restore permissions for cleanup
      await chmod(filePath, 0o644);
    });

    it("should apply credential redaction when redact is true", async () => {
      const filePath = join(tempDir, "settings.json");
      await writeFile(
        filePath,
        JSON.stringify({ password: "my-secret-123" })
      );

      const result = collector.testCreateResult();
      const file = await collector.testSafeReadFile(filePath, result, {
        redact: true,
      });

      expect(file).not.toBeNull();
      // biome-ignore lint/style/noNonNullAssertion: asserted non-null above
      expect(file!.content).toContain("[REDACTED]");
      // biome-ignore lint/style/noNonNullAssertion: asserted non-null above
      expect(file!.content).not.toContain("my-secret-123");
    });
  });

  describe("collectDir", () => {
    it("should collect text files recursively", async () => {
      const subDir = join(tempDir, "sub");
      await mkdir(subDir, { recursive: true });
      await writeFile(join(tempDir, "root.txt"), "root");
      await writeFile(join(subDir, "nested.txt"), "nested");

      const result = collector.testCreateResult();
      const files = await collector.testCollectDir(tempDir, result);

      const paths = files.map((f) => f.path);
      expect(paths).toContain(join(tempDir, "root.txt"));
      expect(paths).toContain(join(subDir, "nested.txt"));
    });

    it("should skip globally excluded directories", async () => {
      const gitDir = join(tempDir, ".git");
      const nmDir = join(tempDir, "node_modules");
      await mkdir(gitDir, { recursive: true });
      await mkdir(nmDir, { recursive: true });
      await writeFile(join(gitDir, "HEAD"), "ref: refs/heads/main");
      await writeFile(join(nmDir, "package.json"), "{}");
      await writeFile(join(tempDir, "config.txt"), "hello");

      const result = collector.testCreateResult();
      const files = await collector.testCollectDir(tempDir, result);

      expect(files).toHaveLength(1);
      expect(files[0].path).toBe(join(tempDir, "config.txt"));
    });

    it("should skip caller-specified excluded directories", async () => {
      const customDir = join(tempDir, "logs");
      await mkdir(customDir, { recursive: true });
      await writeFile(join(customDir, "debug.log"), "log data");
      await writeFile(join(tempDir, "app.txt"), "app");

      const result = collector.testCreateResult();
      const files = await collector.testCollectDir(tempDir, result, {
        excludeDirs: new Set(["logs"]),
      });

      expect(files).toHaveLength(1);
      expect(files[0].path).toBe(join(tempDir, "app.txt"));
    });

    it("should apply filter function", async () => {
      await writeFile(join(tempDir, "keep.json"), "{}");
      await writeFile(join(tempDir, "skip.txt"), "nope");

      const result = collector.testCreateResult();
      const files = await collector.testCollectDir(tempDir, result, {
        filter: (p) => p.endsWith(".json"),
      });

      expect(files).toHaveLength(1);
      expect(files[0].path).toBe(join(tempDir, "keep.json"));
    });

    it("should return empty silently for missing directory (ENOENT)", async () => {
      const result = collector.testCreateResult();
      const files = await collector.testCollectDir(
        join(tempDir, "nonexistent"),
        result
      );

      expect(files).toHaveLength(0);
      expect(result.errors).toHaveLength(0);
    });

    it("should record non-ENOENT directory errors", async () => {
      // Create a directory with no read permission
      const noReadDir = join(tempDir, "noaccess");
      await mkdir(noReadDir, { recursive: true });
      await writeFile(join(noReadDir, "file.txt"), "data");
      await chmod(noReadDir, 0o000);

      const result = collector.testCreateResult();
      const files = await collector.testCollectDir(noReadDir, result);

      expect(files).toHaveLength(0);
      expect(result.errors).toHaveLength(1);
      expect(result.errors[0]).toContain("Failed to read directory");

      // Restore permissions for cleanup
      await chmod(noReadDir, 0o755);
    });

    it("should skip binary files in directory", async () => {
      await writeFile(join(tempDir, "readme.md"), "# Hello");
      await writeFile(join(tempDir, "photo.jpg"), "fake-jpg");
      await writeFile(join(tempDir, "data.sqlite"), "fake-db");

      const result = collector.testCreateResult();
      const files = await collector.testCollectDir(tempDir, result);

      expect(files).toHaveLength(1);
      expect(files[0].path).toBe(join(tempDir, "readme.md"));
    });
  });

  describe("timed", () => {
    it("should measure execution time", async () => {
      const result = await collector.collect();

      expect(result.durationMs).toBeGreaterThanOrEqual(0);
      expect(result.id).toBe("test");
      expect(result.label).toBe("Test Collector");
    });
  });
});
