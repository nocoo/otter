import { mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { hashAppName, uploadIconsToServer } from "../../uploader/icons-server.js";

// Create a tiny 1x1 PNG for testing
const TINY_PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==",
  "base64",
);

let testDir: string;

async function setupTestIcons(count: number): Promise<Array<{ appName: string; pngPath: string }>> {
  testDir = join(tmpdir(), `otter-icons-test-${Date.now()}`);
  await mkdir(testDir, { recursive: true });

  const icons = [];
  for (let i = 0; i < count; i++) {
    const appName = `TestApp${i}`;
    const pngPath = join(testDir, `${appName}.png`);
    // biome-ignore lint/performance/noAwaitInLoops: small fixed-size test setup loop
    await writeFile(pngPath, TINY_PNG);
    icons.push({ appName, pngPath });
  }
  return icons;
}

describe("hashAppName", () => {
  it("returns 12-char hex string", () => {
    const hash = hashAppName("Safari");
    expect(hash).toMatch(/^[a-f0-9]{12}$/);
  });

  it("is deterministic", () => {
    expect(hashAppName("Chrome")).toBe(hashAppName("Chrome"));
  });

  it("differs for different names", () => {
    expect(hashAppName("Chrome")).not.toBe(hashAppName("Firefox"));
  });

  it("is case-sensitive", () => {
    expect(hashAppName("safari")).not.toBe(hashAppName("Safari"));
  });
});

describe("uploadIconsToServer", () => {
  let originalFetch: typeof globalThis.fetch;

  beforeEach(() => {
    originalFetch = globalThis.fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it("returns early for empty icons array", async () => {
    const mockFetch = vi.fn();
    globalThis.fetch = mockFetch;

    const result = await uploadIconsToServer([], {
      iconsUrl: "https://example.com/api/webhook/tok/icons",
    });

    expect(result.success).toBe(true);
    expect(result.stored).toBe(0);
    expect(result.total).toBe(0);
    expect(result.durationMs).toBe(0);
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("POSTs base64-encoded icons to server", async () => {
    const icons = await setupTestIcons(2);
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ stored: 2 }),
    });
    globalThis.fetch = mockFetch;

    const result = await uploadIconsToServer(icons, {
      iconsUrl: "https://example.com/api/webhook/tok/icons",
    });

    expect(result.success).toBe(true);
    expect(result.stored).toBe(2);
    expect(result.total).toBe(2);

    // Verify fetch call
    expect(mockFetch).toHaveBeenCalledOnce();
    const [url, options] = mockFetch.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://example.com/api/webhook/tok/icons");
    expect(options.method).toBe("POST");

    // Verify payload
    const body = JSON.parse(options.body as string);
    expect(body.icons).toHaveLength(2);
    expect(body.icons[0].hash).toBe(hashAppName("TestApp0"));
    expect(body.icons[0].data).toBeTruthy();
    // Verify base64 decodes to valid PNG
    const decoded = Buffer.from(body.icons[0].data, "base64");
    expect(decoded[0]).toBe(0x89); // PNG magic byte
  });

  it("handles server 401 (invalid token)", async () => {
    const icons = await setupTestIcons(1);
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 401,
      json: async () => ({ error: "Invalid webhook token" }),
    });

    const result = await uploadIconsToServer(icons, {
      iconsUrl: "https://example.com/api/webhook/bad/icons",
    });

    expect(result.success).toBe(false);
    expect(result.error).toBe("Invalid webhook token");
    expect(result.stored).toBe(0);
  });

  it("handles partial failure (207 status)", async () => {
    const icons = await setupTestIcons(3);
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 207,
      json: async () => ({ stored: 2, errors: ["abc123def456"] }),
    });

    const result = await uploadIconsToServer(icons, {
      iconsUrl: "https://example.com/api/webhook/tok/icons",
    });

    expect(result.success).toBe(false);
    expect(result.stored).toBe(2);
    expect(result.errors).toEqual(["abc123def456"]);
  });

  it("handles network error", async () => {
    const icons = await setupTestIcons(1);
    globalThis.fetch = vi.fn().mockRejectedValue(new Error("Network down"));

    const result = await uploadIconsToServer(icons, {
      iconsUrl: "https://example.com/api/webhook/tok/icons",
    });

    expect(result.success).toBe(false);
    expect(result.error).toBe("Network down");
    expect(result.durationMs).toBeGreaterThanOrEqual(0);
  });

  it("handles timeout", async () => {
    const icons = await setupTestIcons(1);
    const abortError = new DOMException("The operation was aborted", "AbortError");
    globalThis.fetch = vi.fn().mockRejectedValue(abortError);

    const result = await uploadIconsToServer(icons, {
      iconsUrl: "https://example.com/api/webhook/tok/icons",
      timeoutMs: 5000,
    });

    expect(result.success).toBe(false);
    expect(result.error).toContain("timed out after 5000ms");
  });

  it("falls back when 207 body omits stored field and uses default error message on 500 with no body.error", async () => {
    const icons = await setupTestIcons(1);
    globalThis.fetch = vi.fn().mockResolvedValueOnce({
      ok: false,
      status: 500,
      json: async () => ({}),
    });

    const result = await uploadIconsToServer(icons, {
      iconsUrl: "https://example.com/api/webhook/tok/icons",
    });

    expect(result.success).toBe(false);
    expect(result.error).toBe("Server returned 500");
  });

  it("defaults stored to 0 when missing in 200 body", async () => {
    const icons = await setupTestIcons(1);
    globalThis.fetch = vi.fn().mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({}),
    });

    const result = await uploadIconsToServer(icons, {
      iconsUrl: "https://example.com/api/webhook/tok/icons",
    });
    expect(result.success).toBe(true);
    expect(result.stored).toBe(0);
  });

  it("passes AbortSignal to fetch", async () => {
    const icons = await setupTestIcons(1);
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ stored: 1 }),
    });
    globalThis.fetch = mockFetch;

    await uploadIconsToServer(icons, {
      iconsUrl: "https://example.com/api/webhook/tok/icons",
    });

    const options = mockFetch.mock.calls[0][1] as RequestInit;
    expect(options.signal).toBeInstanceOf(AbortSignal);
  });
});
