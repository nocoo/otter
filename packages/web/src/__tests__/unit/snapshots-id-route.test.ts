import { beforeEach, describe, expect, it, vi } from "vitest";

// Mock dependencies
vi.mock("@/lib/session", () => ({
  getAuthUser: vi.fn(),
}));

vi.mock("@/lib/cf/d1", () => ({
  queryFirst: vi.fn(),
}));

vi.mock("@/lib/cf/r2", () => ({
  getSnapshot: vi.fn(),
  snapshotKey: vi.fn((userId: string, snapshotId: string) => `${userId}/${snapshotId}.json`),
}));

import { GET } from "@/app/api/snapshots/[id]/route";
import { queryFirst } from "@/lib/cf/d1";
import { getSnapshot } from "@/lib/cf/r2";
import { getAuthUser } from "@/lib/session";

const mockGetAuthUser = vi.mocked(getAuthUser);
const mockQueryFirst = vi.mocked(queryFirst);
const mockGetSnapshot = vi.mocked(getSnapshot);

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

const mockRow = {
  id: "snap-1",
  user_id: "user-1",
  webhook_id: "wh-1",
  hostname: "my-mac",
  platform: "darwin",
  arch: "arm64",
  username: "testuser",
  collector_count: 5,
  file_count: 21,
  list_count: 201,
  size_bytes: 72000,
  r2_key: "user-1/snap-1.json",
  snapshot_at: 1709700000000,
  uploaded_at: 1709700100000,
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

  it("returns 404 when snapshot not found in D1", async () => {
    mockGetAuthUser.mockResolvedValue(mockUser);
    mockQueryFirst.mockResolvedValue(null);

    const response = await GET(makeRequest(), makeParams("nonexistent"));
    expect(response.status).toBe(404);
    const data = await response.json();
    expect(data.error).toBe("Snapshot not found");
  });

  it("returns 404 when snapshot data not found in R2", async () => {
    mockGetAuthUser.mockResolvedValue(mockUser);
    mockQueryFirst.mockResolvedValue(mockRow);
    mockGetSnapshot.mockResolvedValue(null);

    const response = await GET(makeRequest(), makeParams("snap-1"));
    expect(response.status).toBe(404);
    const data = await response.json();
    expect(data.error).toBe("Snapshot data not found in storage");
  });

  it("returns snapshot metadata and full data", async () => {
    mockGetAuthUser.mockResolvedValue(mockUser);
    mockQueryFirst.mockResolvedValue(mockRow);
    mockGetSnapshot.mockResolvedValue(mockSnapshotData);

    const response = await GET(makeRequest(), makeParams("snap-1"));
    expect(response.status).toBe(200);
    const result = await response.json();

    expect(result.snapshot).toEqual({
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
    });
    expect(result.data).toEqual(mockSnapshotData);
  });

  it("queries D1 with correct user_id scope", async () => {
    mockGetAuthUser.mockResolvedValue({
      id: "user-42",
      email: "test@example.com",
      name: "Test",
      image: null,
    });
    mockQueryFirst.mockResolvedValue(null);

    await GET(makeRequest(), makeParams("snap-abc"));
    expect(mockQueryFirst).toHaveBeenCalledWith(
      expect.stringContaining("WHERE id = ?1 AND user_id = ?2"),
      ["snap-abc", "user-42"],
    );
  });

  it("fetches R2 data with correct key", async () => {
    mockGetAuthUser.mockResolvedValue(mockUser);
    mockQueryFirst.mockResolvedValue(mockRow);
    mockGetSnapshot.mockResolvedValue(mockSnapshotData);

    await GET(makeRequest(), makeParams("snap-1"));
    expect(mockGetSnapshot).toHaveBeenCalledWith("user-1/snap-1.json");
  });

  it("prevents accessing another user's snapshot", async () => {
    mockGetAuthUser.mockResolvedValue({
      id: "user-other",
      email: "other@example.com",
      name: "Other",
      image: null,
    });
    // D1 query scoped to user_id returns null since it belongs to user-1
    mockQueryFirst.mockResolvedValue(null);

    const response = await GET(makeRequest(), makeParams("snap-1"));
    expect(response.status).toBe(404);
    expect(mockGetSnapshot).not.toHaveBeenCalled();
  });
});
