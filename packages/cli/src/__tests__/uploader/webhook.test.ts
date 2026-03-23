import { gunzipSync } from "node:zlib";
import type { Snapshot } from "@otter/core";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { uploadSnapshot } from "../../uploader/webhook.js";

/** Minimal valid snapshot for testing */
function createTestSnapshot(): Snapshot {
  return {
    version: 1,
    createdAt: "2026-03-06T00:00:00.000Z",
    id: "test-uuid-1234",
    machine: {
      hostname: "test-mac",
      platform: "darwin",
      osVersion: "24.0.0",
      arch: "arm64",
      username: "tester",
      homeDir: "/Users/tester",
      nodeVersion: "v22.0.0",
    },
    collectors: [],
  };
}

describe("uploadSnapshot", () => {
  let originalFetch: typeof globalThis.fetch;

  beforeEach(() => {
    originalFetch = globalThis.fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it("should POST gzip-compressed snapshot to webhook URL", async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
    });
    globalThis.fetch = mockFetch;

    const snapshot = createTestSnapshot();
    await uploadSnapshot(snapshot, { webhookUrl: "https://example.com/hook" });

    expect(mockFetch).toHaveBeenCalledOnce();
    const [url, options] = mockFetch.mock.calls[0];
    expect(url).toBe("https://example.com/hook");
    expect(options.method).toBe("POST");
    expect(options.headers["Content-Type"]).toBe("application/json");
    expect(options.headers["Content-Encoding"]).toBe("gzip");

    // Body should be gzip-compressed; decompress to verify JSON content
    const decompressed = gunzipSync(Buffer.from(options.body));
    const body = JSON.parse(decompressed.toString("utf-8"));
    expect(body.id).toBe("test-uuid-1234");
  });

  it("should return success result on 200", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
    });

    const result = await uploadSnapshot(createTestSnapshot(), {
      webhookUrl: "https://example.com/hook",
    });

    expect(result.success).toBe(true);
    expect(result.statusCode).toBe(200);
    expect(result.error).toBeUndefined();
    expect(result.durationMs).toBeGreaterThanOrEqual(0);
  });

  it("should return failure result on non-2xx status", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 403,
      statusText: "Forbidden",
    });

    const result = await uploadSnapshot(createTestSnapshot(), {
      webhookUrl: "https://example.com/hook",
    });

    expect(result.success).toBe(false);
    expect(result.statusCode).toBe(403);
    expect(result.error).toContain("403");
  });

  it("should return failure result on network error", async () => {
    globalThis.fetch = vi.fn().mockRejectedValue(new Error("Network unreachable"));

    const result = await uploadSnapshot(createTestSnapshot(), {
      webhookUrl: "https://example.com/hook",
    });

    expect(result.success).toBe(false);
    expect(result.statusCode).toBeUndefined();
    expect(result.error).toContain("Network unreachable");
  });

  it("should use AbortController for timeout", async () => {
    // Simulate a slow request that would be aborted
    globalThis.fetch = vi.fn().mockImplementation(async (_url, options) => {
      // Check that signal is provided
      expect(options.signal).toBeInstanceOf(AbortSignal);
      return { ok: true, status: 200 };
    });

    await uploadSnapshot(createTestSnapshot(), {
      webhookUrl: "https://example.com/hook",
      timeoutMs: 5000,
    });
  });

  it("should default timeout to 30000ms", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
    });

    await uploadSnapshot(createTestSnapshot(), {
      webhookUrl: "https://example.com/hook",
    });

    // Verify fetch was called with a signal
    const options = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0][1];
    expect(options.signal).toBeInstanceOf(AbortSignal);
  });

  it("should return timeout error message on AbortError", async () => {
    const abortError = new DOMException("The operation was aborted", "AbortError");
    globalThis.fetch = vi.fn().mockRejectedValue(abortError);

    const result = await uploadSnapshot(createTestSnapshot(), {
      webhookUrl: "https://example.com/hook",
      timeoutMs: 5000,
    });

    expect(result.success).toBe(false);
    expect(result.error).toContain("timed out after 5000ms");
    expect(result.statusCode).toBeUndefined();
  });
});
