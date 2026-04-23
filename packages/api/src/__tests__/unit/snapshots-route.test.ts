import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../middleware/auth", () => {
  let currentUser: { id: string; email: string; name: string | null; image: string | null } | null =
    null;
  return {
    __esModule: true,
    authMiddleware: async (
      c: {
        json: (body: unknown, status?: number) => unknown;
        set: (k: string, v: unknown) => void;
      },
      next: () => Promise<void>,
    ) => {
      if (!currentUser) {
        return c.json({ error: "Unauthorized" }, 401);
      }
      c.set("user", currentUser);
      await next();
    },
    __setUser(user: typeof currentUser) {
      currentUser = user;
    },
  };
});

vi.mock("../../lib/worker-client", () => ({
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

import { createApp } from "../../app";

const app = createApp();

import { listSnapshots, WorkerError } from "../../lib/worker-client";

const { __setUser } = (await import("../../middleware/auth")) as any;

const mockListSnapshots = vi.mocked(listSnapshots);

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

describe("GET /v1/snapshots", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    __setUser(mockUser);
  });

  it("returns 401 when not authenticated", async () => {
    __setUser(null);
    const res = await app.request("/v1/snapshots");
    expect(res.status).toBe(401);
    const data = await res.json();
    expect(data.error).toBe("Unauthorized");
  });

  it("returns empty list when no snapshots exist", async () => {
    mockListSnapshots.mockResolvedValue({ snapshots: [], total: 0, nextBefore: null });
    const res = await app.request("/v1/snapshots");
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.snapshots).toEqual([]);
    expect(data.total).toBe(0);
    expect(data.nextBefore).toBeNull();
  });

  it("returns snapshots from Worker", async () => {
    mockListSnapshots.mockResolvedValue({
      snapshots: mockSnapshots,
      total: 2,
      nextBefore: null,
    });
    const res = await app.request("/v1/snapshots");
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.snapshots).toHaveLength(2);
    expect(data.snapshots[0]).toEqual(mockSnapshots[0]);
    expect(data.total).toBe(2);
  });

  it("passes user ID to Worker client", async () => {
    __setUser({ id: "user-42", email: "test@example.com", name: "Test", image: null });
    mockListSnapshots.mockResolvedValue({ snapshots: [], total: 0, nextBefore: null });
    await app.request("/v1/snapshots");
    expect(mockListSnapshots).toHaveBeenCalledWith("user-42", {});
  });

  it("passes limit parameter to Worker", async () => {
    mockListSnapshots.mockResolvedValue({ snapshots: [], total: 0, nextBefore: null });
    await app.request("/v1/snapshots?limit=5");
    expect(mockListSnapshots).toHaveBeenCalledWith("user-1", { limit: 5 });
  });

  it("passes before cursor to Worker", async () => {
    mockListSnapshots.mockResolvedValue({ snapshots: [], total: 10, nextBefore: null });
    await app.request("/v1/snapshots?before=1709700000000");
    expect(mockListSnapshots).toHaveBeenCalledWith("user-1", { before: 1709700000000 });
  });

  it("passes both limit and before to Worker", async () => {
    mockListSnapshots.mockResolvedValue({ snapshots: [], total: 10, nextBefore: null });
    await app.request("/v1/snapshots?limit=10&before=1709700000000");
    expect(mockListSnapshots).toHaveBeenCalledWith("user-1", { limit: 10, before: 1709700000000 });
  });

  it("returns Worker error with correct status", async () => {
    mockListSnapshots.mockRejectedValue(new WorkerError("Internal error", 500));
    const res = await app.request("/v1/snapshots");
    expect(res.status).toBe(500);
    const data = await res.json();
    expect(data.error).toBe("Internal error");
  });

  it("handles generic errors", async () => {
    mockListSnapshots.mockRejectedValue(new Error("Network error"));
    const res = await app.request("/v1/snapshots");
    expect(res.status).toBe(500);
    const data = await res.json();
    expect(data.error).toBe("Failed to fetch snapshots");
  });

  it("returns nextBefore from Worker response", async () => {
    mockListSnapshots.mockResolvedValue({
      snapshots: mockSnapshots,
      total: 50,
      nextBefore: 1709600100000,
    });
    const res = await app.request("/v1/snapshots");
    const data = await res.json();
    expect(data.nextBefore).toBe(1709600100000);
    expect(data.total).toBe(50);
  });
});
