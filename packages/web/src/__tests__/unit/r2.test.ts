import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Mock the entire @aws-sdk/client-s3 module
const mockSend = vi.fn();

vi.mock("@aws-sdk/client-s3", () => {
  return {
    S3Client: vi.fn().mockImplementation(() => ({ send: mockSend })),
    PutObjectCommand: vi.fn().mockImplementation((input) => ({ ...input, _type: "Put" })),
    GetObjectCommand: vi.fn().mockImplementation((input) => ({ ...input, _type: "Get" })),
    DeleteObjectCommand: vi.fn().mockImplementation((input) => ({ ...input, _type: "Delete" })),
    HeadObjectCommand: vi.fn().mockImplementation((input) => ({ ...input, _type: "Head" })),
  };
});

const originalEnv = { ...process.env };

function setupSnapshotEnv() {
  process.env.CF_R2_ENDPOINT = "https://r2.example.com";
  process.env.CF_R2_ACCESS_KEY_ID = "snap-key";
  process.env.CF_R2_SECRET_ACCESS_KEY = "snap-secret";
  process.env.CF_R2_BUCKET = "otter-snapshots";
}

describe("R2 client", () => {
  beforeEach(async () => {
    vi.resetModules();
    mockSend.mockReset();
    setupSnapshotEnv();
    delete process.env.CF_ICON_R2_ENDPOINT;
    delete process.env.CF_ICON_R2_ACCESS_KEY_ID;
    delete process.env.CF_ICON_R2_SECRET_ACCESS_KEY;
    delete process.env.CF_ICON_R2_BUCKET;
    delete process.env.CF_ICON_R2_PREFIX;
  });

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  // --- env validation ---

  it("throws when snapshot R2 env vars are missing", async () => {
    delete process.env.CF_R2_ENDPOINT;
    const { putSnapshot } = await import("@/lib/cf/r2");
    await expect(putSnapshot("key", {})).rejects.toThrow("Missing Cloudflare R2 env vars");
  });

  // --- E2E test isolation guard ---

  it("throws in E2E mode when CF_R2_TEST_BUCKET is missing", async () => {
    process.env.E2E_SKIP_AUTH = "true";
    const { putSnapshot } = await import("@/lib/cf/r2");
    await expect(putSnapshot("key", {})).rejects.toThrow(
      "R2 safety: E2E mode active but CF_R2_TEST_BUCKET not set",
    );
  });

  it("throws in E2E mode when bucket names don't match", async () => {
    process.env.E2E_SKIP_AUTH = "true";
    process.env.CF_R2_TEST_BUCKET = "different-bucket";
    const { putSnapshot } = await import("@/lib/cf/r2");
    await expect(putSnapshot("key", {})).rejects.toThrow("R2 safety: CF_R2_BUCKET");
  });

  it("passes in E2E mode when bucket names match", async () => {
    process.env.E2E_SKIP_AUTH = "true";
    process.env.CF_R2_TEST_BUCKET = "otter-snapshots";
    mockSend.mockResolvedValueOnce({});
    const { putSnapshot } = await import("@/lib/cf/r2");
    await putSnapshot("key", { foo: "bar" });
    expect(mockSend).toHaveBeenCalledOnce();
  });

  it("does not trigger R2 guard when E2E_SKIP_AUTH is not set", async () => {
    delete process.env.E2E_SKIP_AUTH;
    mockSend.mockResolvedValueOnce({});
    const { putSnapshot } = await import("@/lib/cf/r2");
    await putSnapshot("key", { foo: "bar" });
    expect(mockSend).toHaveBeenCalledOnce();
  });

  // --- snapshotKey ---

  it("generates correct snapshot key", async () => {
    const { snapshotKey } = await import("@/lib/cf/r2");
    expect(snapshotKey("user-1", "snap-abc")).toBe("user-1/snap-abc.json");
  });

  // --- iconKey ---

  it("generates correct icon key with default prefix", async () => {
    const { iconKey } = await import("@/lib/cf/r2");
    expect(iconKey("abcdef012345")).toBe("apps/otter/abcdef012345.png");
  });

  it("generates correct icon key with custom prefix", async () => {
    const { iconKey } = await import("@/lib/cf/r2");
    expect(iconKey("abc123", "custom/prefix")).toBe("custom/prefix/abc123.png");
  });

  // --- putSnapshot ---

  it("puts JSON snapshot to R2", async () => {
    mockSend.mockResolvedValueOnce({});

    const { putSnapshot } = await import("@/lib/cf/r2");
    await putSnapshot("user-1/snap-1.json", { foo: "bar" });

    expect(mockSend).toHaveBeenCalledOnce();
    // biome-ignore lint/style/noNonNullAssertion: mock array access in test
    const cmd = mockSend.mock.calls[0]![0];
    expect(cmd.Bucket).toBe("otter-snapshots");
    expect(cmd.Key).toBe("user-1/snap-1.json");
    expect(cmd.ContentType).toBe("application/json");
    expect(cmd.Body).toBe(JSON.stringify({ foo: "bar" }));
  });

  // --- getSnapshot ---

  it("gets and parses JSON snapshot from R2", async () => {
    const data = { version: 1, id: "snap-1" };
    mockSend.mockResolvedValueOnce({
      Body: {
        transformToString: async () => JSON.stringify(data),
      },
    });

    const { getSnapshot } = await import("@/lib/cf/r2");
    const result = await getSnapshot("user-1/snap-1.json");

    expect(result).toEqual(data);
  });

  it("returns null when Body is empty", async () => {
    mockSend.mockResolvedValueOnce({ Body: null });

    const { getSnapshot } = await import("@/lib/cf/r2");
    const result = await getSnapshot("user-1/missing.json");

    expect(result).toBeNull();
  });

  it("returns null on NoSuchKey error", async () => {
    const err = new Error("NoSuchKey");
    err.name = "NoSuchKey";
    mockSend.mockRejectedValueOnce(err);

    const { getSnapshot } = await import("@/lib/cf/r2");
    const result = await getSnapshot("user-1/missing.json");

    expect(result).toBeNull();
  });

  it("rethrows non-NoSuchKey errors from getSnapshot", async () => {
    mockSend.mockRejectedValueOnce(new Error("network failure"));

    const { getSnapshot } = await import("@/lib/cf/r2");
    await expect(getSnapshot("key")).rejects.toThrow("network failure");
  });

  // --- deleteSnapshot ---

  it("deletes snapshot from R2", async () => {
    mockSend.mockResolvedValueOnce({});

    const { deleteSnapshot } = await import("@/lib/cf/r2");
    await deleteSnapshot("user-1/snap-1.json");

    expect(mockSend).toHaveBeenCalledOnce();
    // biome-ignore lint/style/noNonNullAssertion: mock array access in test
    const cmd = mockSend.mock.calls[0]![0];
    expect(cmd.Bucket).toBe("otter-snapshots");
    expect(cmd.Key).toBe("user-1/snap-1.json");
  });

  // --- snapshotExists ---

  it("returns true when snapshot exists", async () => {
    mockSend.mockResolvedValueOnce({});

    const { snapshotExists } = await import("@/lib/cf/r2");
    const exists = await snapshotExists("user-1/snap-1.json");

    expect(exists).toBe(true);
  });

  it("returns false on NotFound", async () => {
    const err = new Error("NotFound");
    err.name = "NotFound";
    mockSend.mockRejectedValueOnce(err);

    const { snapshotExists } = await import("@/lib/cf/r2");
    const exists = await snapshotExists("user-1/missing.json");

    expect(exists).toBe(false);
  });

  it("rethrows non-NotFound errors from snapshotExists", async () => {
    mockSend.mockRejectedValueOnce(new Error("timeout"));

    const { snapshotExists } = await import("@/lib/cf/r2");
    await expect(snapshotExists("key")).rejects.toThrow("timeout");
  });

  // --- putIcon ---

  it("puts icon with immutable cache control", async () => {
    mockSend.mockResolvedValueOnce({});

    const { putIcon } = await import("@/lib/cf/r2");
    const buf = Buffer.from("fake-png-data");
    await putIcon("abc123", buf);

    expect(mockSend).toHaveBeenCalledOnce();
    // biome-ignore lint/style/noNonNullAssertion: mock array access in test
    const cmd = mockSend.mock.calls[0]![0];
    expect(cmd.Key).toBe("apps/otter/abc123.png");
    expect(cmd.ContentType).toBe("image/png");
    expect(cmd.CacheControl).toContain("immutable");
    expect(cmd.Body).toBe(buf);
  });

  // --- iconExists ---

  it("returns true when icon exists", async () => {
    mockSend.mockResolvedValueOnce({});

    const { iconExists } = await import("@/lib/cf/r2");
    expect(await iconExists("abc123")).toBe(true);
  });

  it("returns false when icon not found", async () => {
    const err = new Error("NotFound");
    err.name = "NotFound";
    mockSend.mockRejectedValueOnce(err);

    const { iconExists } = await import("@/lib/cf/r2");
    expect(await iconExists("abc123")).toBe(false);
  });

  it("rethrows non-NotFound errors from iconExists", async () => {
    mockSend.mockRejectedValueOnce(new Error("access denied"));

    const { iconExists } = await import("@/lib/cf/r2");
    await expect(iconExists("abc123")).rejects.toThrow("access denied");
  });

  // --- icon config with dedicated bucket ---

  it("uses dedicated icon bucket when configured", async () => {
    process.env.CF_ICON_R2_ENDPOINT = "https://icons.example.com";
    process.env.CF_ICON_R2_ACCESS_KEY_ID = "icon-key";
    process.env.CF_ICON_R2_SECRET_ACCESS_KEY = "icon-secret";
    process.env.CF_ICON_R2_BUCKET = "icons-bucket";
    process.env.CF_ICON_R2_PREFIX = "custom/icons";

    mockSend.mockResolvedValueOnce({});

    const { putIcon } = await import("@/lib/cf/r2");
    await putIcon("hash123", Buffer.from("png"));

    // biome-ignore lint/style/noNonNullAssertion: mock array access in test
    const cmd = mockSend.mock.calls[0]![0];
    expect(cmd.Bucket).toBe("icons-bucket");
    expect(cmd.Key).toBe("custom/icons/hash123.png");
  });
});
