import { describe, it, expect, vi, beforeEach } from "vitest";
import { gzipSync } from "node:zlib";

// Mock dependencies
vi.mock("@/lib/cf/d1", () => ({
  queryFirst: vi.fn(),
  execute: vi.fn(),
  batch: vi.fn(),
}));

vi.mock("@/lib/cf/r2", () => ({
  putSnapshot: vi.fn(),
  snapshotKey: vi.fn(
    (userId: string, snapshotId: string) => `${userId}/${snapshotId}.json`,
  ),
}));

import { POST } from "@/app/api/webhook/[token]/route";
import { queryFirst, batch } from "@/lib/cf/d1";
import { putSnapshot } from "@/lib/cf/r2";

const mockQueryFirst = vi.mocked(queryFirst);
const mockBatch = vi.mocked(batch);
const mockPutSnapshot = vi.mocked(putSnapshot);

// Valid snapshot fixture
const validSnapshot = {
  version: 1,
  id: "snap-123",
  createdAt: "2026-03-06T00:00:00.000Z",
  machine: {
    hostname: "my-mac",
    platform: "darwin",
    osVersion: "15.0",
    arch: "arm64",
    username: "testuser",
    homeDir: "/Users/testuser",
    nodeVersion: "22.0.0",
  },
  collectors: [
    {
      id: "shell-config",
      label: "Shell Config",
      category: "config",
      files: [
        { path: "/Users/testuser/.zshrc", content: "# zshrc", sizeBytes: 7 },
      ],
      lists: [],
      errors: [],
      durationMs: 50,
    },
    {
      id: "homebrew",
      label: "Homebrew",
      category: "environment",
      files: [],
      lists: [
        { name: "git", version: "2.44" },
        { name: "node", version: "22.0" },
      ],
      errors: [],
      durationMs: 100,
    },
  ],
};

function makeParams(token: string): { params: Promise<{ token: string }> } {
  return { params: Promise.resolve({ token }) };
}

function makeGzipRequest(body: unknown): Request {
  const json = JSON.stringify(body);
  const compressed = gzipSync(json);
  return new Request("http://localhost/api/webhook/test-token", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Content-Encoding": "gzip",
    },
    body: compressed,
  });
}

function makePlainRequest(body: unknown): Request {
  return new Request("http://localhost/api/webhook/test-token", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("POST /api/webhook/[token]", () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it("returns 401 for invalid token", async () => {
    mockQueryFirst.mockResolvedValue(null);
    const response = await POST(
      makeGzipRequest(validSnapshot),
      makeParams("bad-token"),
    );
    expect(response.status).toBe(401);
    const data = await response.json();
    expect(data.error).toBe("Invalid webhook token");
  });

  it("returns 403 for disabled webhook", async () => {
    mockQueryFirst.mockResolvedValue({
      id: "wh-1",
      user_id: "user-1",
      token: "test-token",
      is_active: 0,
    });
    const response = await POST(
      makeGzipRequest(validSnapshot),
      makeParams("test-token"),
    );
    expect(response.status).toBe(403);
    const data = await response.json();
    expect(data.error).toBe("Webhook is disabled");
  });

  it("handles gzip-compressed body", async () => {
    mockQueryFirst.mockResolvedValue({
      id: "wh-1",
      user_id: "user-1",
      token: "test-token",
      is_active: 1,
    });
    mockPutSnapshot.mockResolvedValue(undefined);
    mockBatch.mockResolvedValue(undefined);

    const response = await POST(
      makeGzipRequest(validSnapshot),
      makeParams("test-token"),
    );
    expect(response.status).toBe(201);
    const data = await response.json();
    expect(data.success).toBe(true);
    expect(data.snapshotId).toBe("snap-123");
  });

  it("handles plain (non-gzip) body", async () => {
    mockQueryFirst.mockResolvedValue({
      id: "wh-1",
      user_id: "user-1",
      token: "test-token",
      is_active: 1,
    });
    mockPutSnapshot.mockResolvedValue(undefined);
    mockBatch.mockResolvedValue(undefined);

    const response = await POST(
      makePlainRequest(validSnapshot),
      makeParams("test-token"),
    );
    expect(response.status).toBe(201);
  });

  it("returns 400 for invalid JSON", async () => {
    mockQueryFirst.mockResolvedValue({
      id: "wh-1",
      user_id: "user-1",
      token: "test-token",
      is_active: 1,
    });

    const response = await POST(
      new Request("http://localhost/api/webhook/test-token", {
        method: "POST",
        body: "not json at all",
      }),
      makeParams("test-token"),
    );
    expect(response.status).toBe(400);
  });

  it("returns 400 for invalid snapshot format", async () => {
    mockQueryFirst.mockResolvedValue({
      id: "wh-1",
      user_id: "user-1",
      token: "test-token",
      is_active: 1,
    });

    const response = await POST(
      makePlainRequest({ not: "a snapshot" }),
      makeParams("test-token"),
    );
    expect(response.status).toBe(400);
    const data = await response.json();
    expect(data.error).toBe("Invalid snapshot format");
  });

  it("stores snapshot in R2 with correct key", async () => {
    mockQueryFirst.mockResolvedValue({
      id: "wh-1",
      user_id: "user-1",
      token: "test-token",
      is_active: 1,
    });
    mockPutSnapshot.mockResolvedValue(undefined);
    mockBatch.mockResolvedValue(undefined);

    await POST(makeGzipRequest(validSnapshot), makeParams("test-token"));
    expect(mockPutSnapshot).toHaveBeenCalledWith(
      "user-1/snap-123.json",
      validSnapshot,
    );
  });

  it("writes correct metadata to D1", async () => {
    mockQueryFirst.mockResolvedValue({
      id: "wh-1",
      user_id: "user-1",
      token: "test-token",
      is_active: 1,
    });
    mockPutSnapshot.mockResolvedValue(undefined);
    mockBatch.mockResolvedValue(undefined);

    await POST(makeGzipRequest(validSnapshot), makeParams("test-token"));

    expect(mockBatch).toHaveBeenCalledWith([
      {
        sql: expect.stringContaining("INSERT INTO snapshots"),
        params: [
          "snap-123", // id
          "user-1", // user_id
          "wh-1", // webhook_id
          "my-mac", // hostname
          "darwin", // platform
          "arm64", // arch
          "testuser", // username
          2, // collector_count
          1, // file_count (1 file in shell-config)
          2, // list_count (2 items in homebrew)
          expect.any(Number), // size_bytes
          "user-1/snap-123.json", // r2_key
          expect.any(Number), // snapshot_at
          expect.any(Number), // uploaded_at
        ],
      },
      {
        sql: expect.stringContaining("UPDATE webhooks SET last_used_at"),
        params: [expect.any(Number), "wh-1"],
      },
    ]);
  });

  it("returns 500 when R2 storage fails", async () => {
    mockQueryFirst.mockResolvedValue({
      id: "wh-1",
      user_id: "user-1",
      token: "test-token",
      is_active: 1,
    });
    mockPutSnapshot.mockRejectedValue(new Error("R2 connection failed"));

    const response = await POST(
      makeGzipRequest(validSnapshot),
      makeParams("test-token"),
    );
    expect(response.status).toBe(500);
    const data = await response.json();
    expect(data.error).toBe("Failed to store snapshot");
  });

  it("returns 500 when D1 batch fails", async () => {
    mockQueryFirst.mockResolvedValue({
      id: "wh-1",
      user_id: "user-1",
      token: "test-token",
      is_active: 1,
    });
    mockPutSnapshot.mockResolvedValue(undefined);
    mockBatch.mockRejectedValue(new Error("D1 timeout"));

    const response = await POST(
      makeGzipRequest(validSnapshot),
      makeParams("test-token"),
    );
    expect(response.status).toBe(500);
    const data = await response.json();
    expect(data.error).toBe("Failed to index snapshot");
  });
});
