import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../middleware/auth.js", () => {
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

vi.mock("../../lib/worker-client.js", () => ({
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

import { createApp } from "../../app.js";

const app = createApp();

import { deleteSnapshot, getSnapshot, WorkerError } from "../../lib/worker-client.js";

const { __setUser } = (await import("../../middleware/auth.js")) as any;

const mockGetSnapshot = vi.mocked(getSnapshot);
const mockDeleteSnapshot = vi.mocked(deleteSnapshot);

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

describe("GET /v1/snapshots/:id", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    __setUser(mockUser);
  });

  it("returns 401 when not authenticated", async () => {
    __setUser(null);
    const res = await app.request("/v1/snapshots/snap-1");
    expect(res.status).toBe(401);
    const data = await res.json();
    expect(data.error).toBe("Unauthorized");
  });

  it("returns 404 when snapshot not found", async () => {
    mockGetSnapshot.mockRejectedValue(new WorkerError("Snapshot not found", 404));
    const res = await app.request("/v1/snapshots/nonexistent");
    expect(res.status).toBe(404);
    const data = await res.json();
    expect(data.error).toBe("Snapshot not found");
  });

  it("returns snapshot metadata and full data", async () => {
    mockGetSnapshot.mockResolvedValue({
      snapshot: mockSnapshotMeta,
      data: mockSnapshotData,
    });
    const res = await app.request("/v1/snapshots/snap-1");
    expect(res.status).toBe(200);
    const result = await res.json();
    expect(result.snapshot).toEqual(mockSnapshotMeta);
    expect(result.data).toEqual(mockSnapshotData);
  });

  it("passes user ID and snapshot ID to Worker", async () => {
    __setUser({ id: "user-42", email: "test@example.com", name: "Test", image: null });
    mockGetSnapshot.mockRejectedValue(new WorkerError("Not found", 404));
    await app.request("/v1/snapshots/snap-abc");
    expect(mockGetSnapshot).toHaveBeenCalledWith("user-42", "snap-abc");
  });

  it("handles Worker errors with correct status", async () => {
    mockGetSnapshot.mockRejectedValue(new WorkerError("Snapshot data not found in storage", 404));
    const res = await app.request("/v1/snapshots/snap-1");
    expect(res.status).toBe(404);
    const data = await res.json();
    expect(data.error).toBe("Snapshot data not found in storage");
  });

  it("handles generic errors", async () => {
    mockGetSnapshot.mockRejectedValue(new Error("Network error"));
    const res = await app.request("/v1/snapshots/snap-1");
    expect(res.status).toBe(500);
    const data = await res.json();
    expect(data.error).toBe("Failed to fetch snapshot");
  });
});

describe("DELETE /v1/snapshots/:id", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    __setUser(mockUser);
  });

  it("returns 401 when not authenticated", async () => {
    __setUser(null);
    const res = await app.request("/v1/snapshots/snap-1", { method: "DELETE" });
    expect(res.status).toBe(401);
    const data = await res.json();
    expect(data.error).toBe("Unauthorized");
  });

  it("returns success when snapshot is deleted", async () => {
    mockDeleteSnapshot.mockResolvedValue({ success: true });
    const res = await app.request("/v1/snapshots/snap-1", { method: "DELETE" });
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.success).toBe(true);
  });

  it("returns 404 when snapshot not found", async () => {
    mockDeleteSnapshot.mockRejectedValue(new WorkerError("Snapshot not found", 404));
    const res = await app.request("/v1/snapshots/nonexistent", { method: "DELETE" });
    expect(res.status).toBe(404);
    const data = await res.json();
    expect(data.error).toBe("Snapshot not found");
  });

  it("passes user ID and snapshot ID to Worker", async () => {
    __setUser({ id: "user-42", email: "test@example.com", name: "Test", image: null });
    mockDeleteSnapshot.mockResolvedValue({ success: true });
    await app.request("/v1/snapshots/snap-abc", { method: "DELETE" });
    expect(mockDeleteSnapshot).toHaveBeenCalledWith("user-42", "snap-abc");
  });

  it("handles generic errors", async () => {
    mockDeleteSnapshot.mockRejectedValue(new Error("Network error"));
    const res = await app.request("/v1/snapshots/snap-1", { method: "DELETE" });
    expect(res.status).toBe(500);
    const data = await res.json();
    expect(data.error).toBe("Failed to delete snapshot");
  });
});
