import { beforeEach, describe, expect, it, vi } from "vitest";

// Mock dependencies
vi.mock("@/lib/session", () => ({
  getAuthUser: vi.fn(),
}));

vi.mock("@/lib/worker-client", () => ({
  listSnapshots: vi.fn(),
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

import { NextRequest } from "next/server";
import { GET } from "@/app/api/snapshots/route";
import { getAuthUser } from "@/lib/session";
import { listSnapshots, WorkerError } from "@/lib/worker-client";

const mockGetAuthUser = vi.mocked(getAuthUser);
const mockListSnapshots = vi.mocked(listSnapshots);

function makeRequest(url = "http://localhost/api/snapshots"): NextRequest {
  return new NextRequest(url);
}

const mockUser = {
  id: "user-1",
  email: "test@example.com",
  name: "Test",
  image: null,
};

const mockSnapshots = [
  {
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
  },
  {
    id: "snap-2",
    hostname: "my-mac",
    platform: "darwin",
    arch: "arm64",
    username: "testuser",
    collectorCount: 5,
    fileCount: 20,
    listCount: 195,
    sizeBytes: 70000,
    snapshotAt: 1709600000000,
    uploadedAt: 1709600100000,
  },
];

describe("GET /api/snapshots", () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it("returns 401 when not authenticated", async () => {
    mockGetAuthUser.mockResolvedValue(null);
    const response = await GET(makeRequest());
    expect(response.status).toBe(401);
    const data = await response.json();
    expect(data.error).toBe("Unauthorized");
  });

  it("returns empty list when no snapshots exist", async () => {
    mockGetAuthUser.mockResolvedValue(mockUser);
    mockListSnapshots.mockResolvedValue({ snapshots: [], total: 0, nextBefore: null });

    const response = await GET(makeRequest());
    expect(response.status).toBe(200);
    const data = await response.json();
    expect(data.snapshots).toEqual([]);
    expect(data.total).toBe(0);
    expect(data.nextBefore).toBeNull();
  });

  it("returns snapshots from Worker", async () => {
    mockGetAuthUser.mockResolvedValue(mockUser);
    mockListSnapshots.mockResolvedValue({
      snapshots: mockSnapshots,
      total: 2,
      nextBefore: null,
    });

    const response = await GET(makeRequest());
    expect(response.status).toBe(200);
    const data = await response.json();
    expect(data.snapshots).toHaveLength(2);
    expect(data.snapshots[0]).toEqual(mockSnapshots[0]);
    expect(data.total).toBe(2);
  });

  it("passes user ID to Worker client", async () => {
    mockGetAuthUser.mockResolvedValue({
      id: "user-42",
      email: "test@example.com",
      name: "Test",
      image: null,
    });
    mockListSnapshots.mockResolvedValue({ snapshots: [], total: 0, nextBefore: null });

    await GET(makeRequest());
    expect(mockListSnapshots).toHaveBeenCalledWith("user-42", {});
  });

  it("passes limit parameter to Worker", async () => {
    mockGetAuthUser.mockResolvedValue(mockUser);
    mockListSnapshots.mockResolvedValue({ snapshots: [], total: 0, nextBefore: null });

    await GET(makeRequest("http://localhost/api/snapshots?limit=5"));
    expect(mockListSnapshots).toHaveBeenCalledWith("user-1", { limit: 5 });
  });

  it("passes before cursor to Worker", async () => {
    mockGetAuthUser.mockResolvedValue(mockUser);
    mockListSnapshots.mockResolvedValue({ snapshots: [], total: 10, nextBefore: null });

    await GET(makeRequest("http://localhost/api/snapshots?before=1709700000000"));
    expect(mockListSnapshots).toHaveBeenCalledWith("user-1", { before: 1709700000000 });
  });

  it("passes both limit and before to Worker", async () => {
    mockGetAuthUser.mockResolvedValue(mockUser);
    mockListSnapshots.mockResolvedValue({ snapshots: [], total: 10, nextBefore: null });

    await GET(makeRequest("http://localhost/api/snapshots?limit=10&before=1709700000000"));
    expect(mockListSnapshots).toHaveBeenCalledWith("user-1", { limit: 10, before: 1709700000000 });
  });

  it("returns Worker error with correct status", async () => {
    mockGetAuthUser.mockResolvedValue(mockUser);
    mockListSnapshots.mockRejectedValue(new WorkerError("Internal error", 500));

    const response = await GET(makeRequest());
    expect(response.status).toBe(500);
    const data = await response.json();
    expect(data.error).toBe("Internal error");
  });

  it("handles generic errors", async () => {
    mockGetAuthUser.mockResolvedValue(mockUser);
    mockListSnapshots.mockRejectedValue(new Error("Network error"));

    const response = await GET(makeRequest());
    expect(response.status).toBe(500);
    const data = await response.json();
    expect(data.error).toBe("Failed to fetch snapshots");
  });

  it("returns nextBefore from Worker response", async () => {
    mockGetAuthUser.mockResolvedValue(mockUser);
    mockListSnapshots.mockResolvedValue({
      snapshots: mockSnapshots,
      total: 50,
      nextBefore: 1709600100000,
    });

    const response = await GET(makeRequest());
    const data = await response.json();
    expect(data.nextBefore).toBe(1709600100000);
    expect(data.total).toBe(50);
  });
});
