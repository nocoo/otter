import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mkdtemp, writeFile, rm, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHash } from "node:crypto";

// Mock the entire @aws-sdk/client-s3 module before importing the SUT
const mockSend = vi.fn();
vi.mock("@aws-sdk/client-s3", () => {
  return {
    S3Client: vi.fn().mockImplementation(() => ({ send: mockSend })),
    PutObjectCommand: vi.fn().mockImplementation((input) => ({
      _type: "PutObject",
      ...input,
    })),
    HeadObjectCommand: vi.fn().mockImplementation((input) => ({
      _type: "HeadObject",
      ...input,
    })),
  };
});

import {
  hashAppName,
  uploadIcon,
  uploadIcons,
  resetIconUploadClient,
  type IconUploadConfig,
  type IconUploadResult,
} from "../../uploader/icons.js";

const TEST_CONFIG: IconUploadConfig = {
  r2Endpoint: "https://fake-account.r2.cloudflarestorage.com",
  r2AccessKeyId: "fake-key",
  r2SecretAccessKey: "fake-secret",
  r2Bucket: "test-bucket",
  r2PublicDomain: "https://cdn.example.com",
};

describe("hashAppName", () => {
  it("should return first 12 hex chars of SHA-256", () => {
    const expected = createHash("sha256")
      .update("Visual Studio Code")
      .digest("hex")
      .slice(0, 12);
    expect(hashAppName("Visual Studio Code")).toBe(expected);
  });

  it("should always return 12 characters", () => {
    expect(hashAppName("a")).toHaveLength(12);
    expect(hashAppName("")).toHaveLength(12);
    expect(hashAppName("A very long application name with spaces")).toHaveLength(
      12,
    );
  });

  it("should be deterministic (same input = same output)", () => {
    expect(hashAppName("Slack")).toBe(hashAppName("Slack"));
  });

  it("should produce different hashes for different app names", () => {
    expect(hashAppName("Slack")).not.toBe(hashAppName("Discord"));
  });

  it("should be case-sensitive", () => {
    expect(hashAppName("slack")).not.toBe(hashAppName("Slack"));
  });
});

describe("uploadIcon", () => {
  let tempDir: string;
  let pngPath: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "otter-icon-upload-"));
    pngPath = join(tempDir, "TestApp.png");
    await writeFile(pngPath, Buffer.from("fake-png-data"));
    mockSend.mockReset();
    resetIconUploadClient();
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  it("should upload when object does not exist", async () => {
    // HeadObject → 404 (not found)
    mockSend.mockRejectedValueOnce(new Error("NotFound"));
    // PutObject → success
    mockSend.mockResolvedValueOnce({});

    const result = await uploadIcon(pngPath, "TestApp", TEST_CONFIG);

    expect(result.uploaded).toBe(true);
    expect(result.appName).toBe("TestApp");
    expect(result.key).toBe(`apps/otter/${hashAppName("TestApp")}.png`);
    expect(result.publicUrl).toBe(
      `https://cdn.example.com/apps/otter/${hashAppName("TestApp")}.png`,
    );
    expect(mockSend).toHaveBeenCalledTimes(2);
  });

  it("should skip upload when object already exists", async () => {
    // HeadObject → 200 (exists)
    mockSend.mockResolvedValueOnce({});

    const result = await uploadIcon(pngPath, "TestApp", TEST_CONFIG);

    expect(result.uploaded).toBe(false);
    expect(result.appName).toBe("TestApp");
    expect(result.publicUrl).toContain("cdn.example.com");
    // Only HeadObject called, no PutObject
    expect(mockSend).toHaveBeenCalledTimes(1);
  });

  it("should use custom prefix when provided", async () => {
    mockSend.mockRejectedValueOnce(new Error("NotFound"));
    mockSend.mockResolvedValueOnce({});

    const config = { ...TEST_CONFIG, prefix: "icons/v2" };
    const result = await uploadIcon(pngPath, "TestApp", config);

    expect(result.key).toBe(`icons/v2/${hashAppName("TestApp")}.png`);
    expect(result.publicUrl).toBe(
      `https://cdn.example.com/icons/v2/${hashAppName("TestApp")}.png`,
    );
  });

  it("should use default prefix 'apps/otter' when not specified", async () => {
    mockSend.mockRejectedValueOnce(new Error("NotFound"));
    mockSend.mockResolvedValueOnce({});

    const result = await uploadIcon(pngPath, "Slack", TEST_CONFIG);

    expect(result.key).toMatch(/^apps\/otter\//);
  });

  it("should send correct PutObject params", async () => {
    mockSend.mockRejectedValueOnce(new Error("NotFound"));
    mockSend.mockResolvedValueOnce({});

    await uploadIcon(pngPath, "TestApp", TEST_CONFIG);

    // Second call is PutObject
    const putCmd = mockSend.mock.calls[1][0];
    expect(putCmd.Bucket).toBe("test-bucket");
    expect(putCmd.ContentType).toBe("image/png");
    expect(putCmd.CacheControl).toBe("public, max-age=31536000, immutable");
    expect(putCmd.Body).toBeInstanceOf(Buffer);
  });

  it("should propagate S3 upload errors", async () => {
    mockSend.mockRejectedValueOnce(new Error("NotFound"));
    mockSend.mockRejectedValueOnce(new Error("AccessDenied"));

    await expect(uploadIcon(pngPath, "TestApp", TEST_CONFIG)).rejects.toThrow(
      "AccessDenied",
    );
  });

  it("should propagate file read errors for missing PNG", async () => {
    mockSend.mockRejectedValueOnce(new Error("NotFound"));

    await expect(
      uploadIcon("/nonexistent/path.png", "TestApp", TEST_CONFIG),
    ).rejects.toThrow();
  });
});

describe("uploadIcons", () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "otter-icons-batch-"));
    mockSend.mockReset();
    resetIconUploadClient();
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  it("should upload multiple icons in sequence", async () => {
    // Create 3 fake PNG files
    const icons: Array<{ appName: string; pngPath: string }> = [];
    for (const name of ["App1", "App2", "App3"]) {
      const p = join(tempDir, `${name}.png`);
      await writeFile(p, `fake-${name}`);
      icons.push({ appName: name, pngPath: p });
    }

    // Each icon: HeadObject (not found) + PutObject (success)
    for (let i = 0; i < 3; i++) {
      mockSend.mockRejectedValueOnce(new Error("NotFound"));
      mockSend.mockResolvedValueOnce({});
    }

    const results = await uploadIcons(icons, TEST_CONFIG);

    expect(results).toHaveLength(3);
    expect(results.every((r) => r.uploaded)).toBe(true);
    expect(results.map((r) => r.appName)).toEqual(["App1", "App2", "App3"]);
  });

  it("should return empty array for empty input", async () => {
    const results = await uploadIcons([], TEST_CONFIG);
    expect(results).toEqual([]);
    expect(mockSend).not.toHaveBeenCalled();
  });

  it("should call onProgress for each icon", async () => {
    const icons: Array<{ appName: string; pngPath: string }> = [];
    for (const name of ["A", "B"]) {
      const p = join(tempDir, `${name}.png`);
      await writeFile(p, `fake-${name}`);
      icons.push({ appName: name, pngPath: p });
    }

    mockSend.mockRejectedValueOnce(new Error("NotFound"));
    mockSend.mockResolvedValueOnce({});
    mockSend.mockRejectedValueOnce(new Error("NotFound"));
    mockSend.mockResolvedValueOnce({});

    const progressResults: IconUploadResult[] = [];
    await uploadIcons(icons, TEST_CONFIG, (r) => progressResults.push(r));

    expect(progressResults).toHaveLength(2);
    expect(progressResults[0].appName).toBe("A");
    expect(progressResults[1].appName).toBe("B");
  });

  it("should mix uploaded and skipped results", async () => {
    const icons: Array<{ appName: string; pngPath: string }> = [];
    for (const name of ["New", "Existing"]) {
      const p = join(tempDir, `${name}.png`);
      await writeFile(p, `fake-${name}`);
      icons.push({ appName: name, pngPath: p });
    }

    // First: not found → upload
    mockSend.mockRejectedValueOnce(new Error("NotFound"));
    mockSend.mockResolvedValueOnce({});
    // Second: exists → skip
    mockSend.mockResolvedValueOnce({});

    const results = await uploadIcons(icons, TEST_CONFIG);

    expect(results[0].uploaded).toBe(true);
    expect(results[1].uploaded).toBe(false);
  });
});

describe("resetIconUploadClient", () => {
  beforeEach(() => {
    mockSend.mockReset();
    resetIconUploadClient();
  });

  it("should allow creating a new client after reset", async () => {
    const tempDir = await mkdtemp(join(tmpdir(), "otter-reset-"));
    const pngPath = join(tempDir, "test.png");
    await writeFile(pngPath, "data");

    // First upload (creates client)
    mockSend.mockRejectedValueOnce(new Error("NotFound"));
    mockSend.mockResolvedValueOnce({});
    await uploadIcon(pngPath, "App1", TEST_CONFIG);

    // Reset and upload again (should create new client)
    resetIconUploadClient();
    mockSend.mockRejectedValueOnce(new Error("NotFound"));
    mockSend.mockResolvedValueOnce({});
    const result = await uploadIcon(pngPath, "App2", TEST_CONFIG);

    expect(result.uploaded).toBe(true);

    await rm(tempDir, { recursive: true, force: true });
  });
});
