import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock dependencies
vi.mock("@/lib/cf/d1", () => ({
  queryFirst: vi.fn(),
}));

vi.mock("@/lib/cf/r2", () => ({
  putIcon: vi.fn(),
}));

import { POST } from "@/app/api/webhook/[token]/icons/route";
import { queryFirst } from "@/lib/cf/d1";
import { putIcon } from "@/lib/cf/r2";

const mockQueryFirst = vi.mocked(queryFirst);
const mockPutIcon = vi.mocked(putIcon);

// A tiny 1x1 transparent PNG as base64
const TINY_PNG_BASE64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";

function makeParams(token: string): { params: Promise<{ token: string }> } {
  return { params: Promise.resolve({ token }) };
}

function makeRequest(body: unknown): Request {
  return new Request("http://localhost/api/webhook/test-token/icons", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

const activeWebhook = {
  id: "wh-1",
  user_id: "user-1",
  token: "test-token",
  is_active: 1,
};

describe("POST /api/webhook/[token]/icons", () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  // --- Auth ---

  it("returns 401 for invalid token", async () => {
    mockQueryFirst.mockResolvedValue(null);
    const res = await POST(
      makeRequest({ icons: [] }),
      makeParams("bad-token"),
    );
    expect(res.status).toBe(401);
    const data = await res.json();
    expect(data.error).toBe("Invalid webhook token");
  });

  it("returns 403 for disabled webhook", async () => {
    mockQueryFirst.mockResolvedValue({ ...activeWebhook, is_active: 0 });
    const res = await POST(
      makeRequest({ icons: [] }),
      makeParams("test-token"),
    );
    expect(res.status).toBe(403);
    const data = await res.json();
    expect(data.error).toBe("Webhook is disabled");
  });

  // --- Validation ---

  it("returns 400 for invalid JSON body", async () => {
    mockQueryFirst.mockResolvedValue(activeWebhook);
    const res = await POST(
      new Request("http://localhost/api/webhook/test-token/icons", {
        method: "POST",
        body: "not json",
      }),
      makeParams("test-token"),
    );
    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data.error).toBe("Invalid JSON body");
  });

  it("returns 400 when icons is not an array", async () => {
    mockQueryFirst.mockResolvedValue(activeWebhook);
    const res = await POST(
      makeRequest({ icons: "not-array" }),
      makeParams("test-token"),
    );
    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data.error).toBe("Invalid request body");
  });

  it("returns 400 for invalid hash format (wrong length)", async () => {
    mockQueryFirst.mockResolvedValue(activeWebhook);
    const res = await POST(
      makeRequest({ icons: [{ hash: "abc", data: TINY_PNG_BASE64 }] }),
      makeParams("test-token"),
    );
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("Invalid request body");
  });

  it("returns 400 for invalid hash format (non-hex chars)", async () => {
    mockQueryFirst.mockResolvedValue(activeWebhook);
    const res = await POST(
      makeRequest({
        icons: [{ hash: "gggggggggggg", data: TINY_PNG_BASE64 }],
      }),
      makeParams("test-token"),
    );
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("Invalid request body");
  });

  it("returns 400 for empty data string", async () => {
    mockQueryFirst.mockResolvedValue(activeWebhook);
    const res = await POST(
      makeRequest({ icons: [{ hash: "abcdef012345", data: "" }] }),
      makeParams("test-token"),
    );
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("Invalid request body");
  });

  it("returns 400 when too many icons", async () => {
    mockQueryFirst.mockResolvedValue(activeWebhook);
    const icons = Array.from({ length: 501 }, (_, i) => ({
      hash: i.toString(16).padStart(12, "0"),
      data: TINY_PNG_BASE64,
    }));
    const res = await POST(
      makeRequest({ icons }),
      makeParams("test-token"),
    );
    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/Too many icons/);
  });

  it("returns 400 when icon data exceeds size limit", async () => {
    mockQueryFirst.mockResolvedValue(activeWebhook);
    const hugeData = "A".repeat(150_001);
    const res = await POST(
      makeRequest({ icons: [{ hash: "abcdef012345", data: hugeData }] }),
      makeParams("test-token"),
    );
    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/exceeds size limit/);
  });

  // --- Happy paths ---

  it("returns 200 with stored: 0 for empty icons array", async () => {
    mockQueryFirst.mockResolvedValue(activeWebhook);
    const res = await POST(
      makeRequest({ icons: [] }),
      makeParams("test-token"),
    );
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.stored).toBe(0);
  });

  it("stores a single icon in R2", async () => {
    mockQueryFirst.mockResolvedValue(activeWebhook);
    mockPutIcon.mockResolvedValue(undefined);

    const res = await POST(
      makeRequest({
        icons: [{ hash: "abcdef012345", data: TINY_PNG_BASE64 }],
      }),
      makeParams("test-token"),
    );
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.stored).toBe(1);

    expect(mockPutIcon).toHaveBeenCalledOnce();
    expect(mockPutIcon).toHaveBeenCalledWith(
      "abcdef012345",
      expect.any(Buffer),
    );
  });

  it("stores multiple icons in R2", async () => {
    mockQueryFirst.mockResolvedValue(activeWebhook);
    mockPutIcon.mockResolvedValue(undefined);

    const icons = [
      { hash: "aaaaaaaaaaaa", data: TINY_PNG_BASE64 },
      { hash: "bbbbbbbbbbbb", data: TINY_PNG_BASE64 },
      { hash: "cccccccccccc", data: TINY_PNG_BASE64 },
    ];

    const res = await POST(
      makeRequest({ icons }),
      makeParams("test-token"),
    );
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.stored).toBe(3);
    expect(mockPutIcon).toHaveBeenCalledTimes(3);
  });

  it("decodes base64 correctly before storing", async () => {
    mockQueryFirst.mockResolvedValue(activeWebhook);
    mockPutIcon.mockResolvedValue(undefined);

    await POST(
      makeRequest({
        icons: [{ hash: "abcdef012345", data: TINY_PNG_BASE64 }],
      }),
      makeParams("test-token"),
    );

    const storedBuffer = mockPutIcon.mock.calls[0]![1] as Buffer;
    // PNG magic bytes: 0x89 0x50 0x4E 0x47
    expect(storedBuffer[0]).toBe(0x89);
    expect(storedBuffer[1]).toBe(0x50);
    expect(storedBuffer[2]).toBe(0x4e);
    expect(storedBuffer[3]).toBe(0x47);
  });

  // --- Error handling ---

  it("returns 207 with partial errors when some icons fail", async () => {
    mockQueryFirst.mockResolvedValue(activeWebhook);
    mockPutIcon
      .mockResolvedValueOnce(undefined) // first succeeds
      .mockRejectedValueOnce(new Error("R2 fail")) // second fails
      .mockResolvedValueOnce(undefined); // third succeeds

    const icons = [
      { hash: "aaaaaaaaaaaa", data: TINY_PNG_BASE64 },
      { hash: "bbbbbbbbbbbb", data: TINY_PNG_BASE64 },
      { hash: "cccccccccccc", data: TINY_PNG_BASE64 },
    ];

    const res = await POST(
      makeRequest({ icons }),
      makeParams("test-token"),
    );
    expect(res.status).toBe(207);
    const data = await res.json();
    expect(data.stored).toBe(2);
    expect(data.errors).toEqual(["bbbbbbbbbbbb"]);
  });

  it("returns 207 when all icons fail to store", async () => {
    mockQueryFirst.mockResolvedValue(activeWebhook);
    mockPutIcon.mockRejectedValue(new Error("R2 down"));

    const res = await POST(
      makeRequest({
        icons: [{ hash: "abcdef012345", data: TINY_PNG_BASE64 }],
      }),
      makeParams("test-token"),
    );
    expect(res.status).toBe(207);
    const data = await res.json();
    expect(data.stored).toBe(0);
    expect(data.errors).toEqual(["abcdef012345"]);
  });
});
