import { beforeEach, describe, expect, it, vi } from "vitest";

// Mock dependencies
vi.mock("@/lib/session", () => ({
  getAuthUser: vi.fn(),
}));

vi.mock("@/lib/worker-client", () => ({
  getSnapshot: vi.fn(),
  deleteSnapshot: vi.fn(),
  WorkerError: class WorkerError extends Error {
    constructor(
      message: string,
      public status: number,
      public body?: unknown,
    ) {
      super(message);
      this.name = "WorkerError";
    }
  },
}));

import { DELETE, GET } from "@/app/api/snapshots/[id]/route";
import { getAuthUser } from "@/lib/session";
import { deleteSnapshot, getSnapshot, WorkerError } from "@/lib/worker-client";

const mockGetAuthUser = vi.mocked(getAuthUser);
const mockGetSnapshot = vi.mocked(getSnapshot);
const mockDeleteSnapshot = vi.mocked(deleteSnapshot);

function makeParams(id: string): { params: Promise<{ id: string }> } {
  return { params: Promise.resolve({ id }) };
}

function makeRequest(): Request {
  return new Request("http://localhost/api/snapshots/snap-1");
}

const mockUser = {
  id: "user-1",
  email: "test@example.com",
  name: "Test",
  image: null,
};

const mockSnapshotMeta = {
  id: "snap-1",
  hostname: "my-mac",
  platform: "darwin",
  arch: "arm64",
  username: "testuser",
  collectorCount: 5,
  fileCount: 21,
  listCount: 201,
  sizeBytes: 72000,
  snapshotAt: 1709700000000,
  uploadedAt: 1709700100000,
};

const mockSnapshotData = {
  version: 1,
  id: "snap-1",
  createdAt: "2026-03-06T00:00:00.000Z",
  machine: {
    hostname: "my-mac",
    platform: "darwin",
    arch: "arm64",
    username: "testuser",
  },
  collectors: [
    {
      id: "shell-config",
      label: "Shell Config",
      category: "config",
      files: [{ path: "/Users/testuser/.zshrc", content: "# zshrc", sizeBytes: 7 }],
      lists: [],
      errors: [],
      skipped: [],
    },
  ],
};

describe("GET /api/snapshots/[id]", () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it("returns 401 when not authenticated", async () => {
    mockGetAuthUser.mockResolvedValue(null);
    const response = await GET(makeRequest(), makeParams("snap-1"));
    expect(response.status).toBe(401);
    const data = await response.json();
    expect(data.error).toBe("Unauthorized");
  });

  it("returns 404 when snapshot not found", async () => {
    mockGetAuthUser.mockResolvedValue(mockUser);
    mockGetSnapshot.mockRejectedValue(new WorkerError("Snapshot not found", 404));

    const response = await GET(makeRequest(), makeParams("nonexistent"));
    expect(response.status).toBe(404);
    const data = await response.json();
    expect(data.error).toBe("Snapshot not found");
  });

  it("returns snapshot metadata and full data", async () => {
    mockGetAuthUser.mockResolvedValue(mockUser);
    mockGetSnapshot.mockResolvedValue({
      snapshot: mockSnapshotMeta,
      data: mockSnapshotData,
    });

    const response = await GET(makeRequest(), makeParams("snap-1"));
    expect(response.status).toBe(200);
    const result = await response.json();

    expect(result.snapshot).toEqual(mockSnapshotMeta);
    expect(result.data).toEqual(mockSnapshotData);
  });

  it("passes user ID and snapshot ID to Worker", async () => {
    mockGetAuthUser.mockResolvedValue({
      id: "user-42",
      email: "test@example.com",
      name: "Test",
      image: null,
    });
    mockGetSnapshot.mockRejectedValue(new WorkerError("Not found", 404));

    await GET(makeRequest(), makeParams("snap-abc"));
    expect(mockGetSnapshot).toHaveBeenCalledWith("user-42", "snap-abc");
  });

  it("handles Worker errors with correct status", async () => {
    mockGetAuthUser.mockResolvedValue(mockUser);
    mockGetSnapshot.mockRejectedValue(new WorkerError("Snapshot data not found in storage", 404));

    const response = await GET(makeRequest(), makeParams("snap-1"));
    expect(response.status).toBe(404);
    const data = await response.json();
    expect(data.error).toBe("Snapshot data not found in storage");
  });

  it("handles generic errors", async () => {
    mockGetAuthUser.mockResolvedValue(mockUser);
    mockGetSnapshot.mockRejectedValue(new Error("Network error"));

    const response = await GET(makeRequest(), makeParams("snap-1"));
    expect(response.status).toBe(500);
    const data = await response.json();
    expect(data.error).toBe("Failed to fetch snapshot");
  });
});

describe("DELETE /api/snapshots/[id]", () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it("returns 401 when not authenticated", async () => {
    mockGetAuthUser.mockResolvedValue(null);
    const response = await DELETE(makeRequest(), makeParams("snap-1"));
    expect(response.status).toBe(401);
    const data = await response.json();
    expect(data.error).toBe("Unauthorized");
  });

  it("returns success when snapshot is deleted", async () => {
    mockGetAuthUser.mockResolvedValue(mockUser);
    mockDeleteSnapshot.mockResolvedValue({ success: true });

    const response = await DELETE(makeRequest(), makeParams("snap-1"));
    expect(response.status).toBe(200);
    const data = await response.json();
    expect(data.success).toBe(true);
  });

  it("returns 404 when snapshot not found", async () => {
    mockGetAuthUser.mockResolvedValue(mockUser);
    mockDeleteSnapshot.mockRejectedValue(new WorkerError("Snapshot not found", 404));

    const response = await DELETE(makeRequest(), makeParams("nonexistent"));
    expect(response.status).toBe(404);
    const data = await response.json();
    expect(data.error).toBe("Snapshot not found");
  });

  it("passes user ID and snapshot ID to Worker", async () => {
    mockGetAuthUser.mockResolvedValue({
      id: "user-42",
      email: "test@example.com",
      name: "Test",
      image: null,
    });
    mockDeleteSnapshot.mockResolvedValue({ success: true });

    await DELETE(makeRequest(), makeParams("snap-abc"));
    expect(mockDeleteSnapshot).toHaveBeenCalledWith("user-42", "snap-abc");
  });

  it("handles generic errors", async () => {
    mockGetAuthUser.mockResolvedValue(mockUser);
    mockDeleteSnapshot.mockRejectedValue(new Error("Network error"));

    const response = await DELETE(makeRequest(), makeParams("snap-1"));
    expect(response.status).toBe(500);
    const data = await response.json();
    expect(data.error).toBe("Failed to delete snapshot");
  });
});
