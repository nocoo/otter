import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock dependencies
vi.mock("@/lib/session", () => ({
  getAuthUser: vi.fn(),
}));

vi.mock("@/lib/cf/d1", () => ({
  query: vi.fn(),
  queryFirst: vi.fn(),
}));

import { GET } from "@/app/api/snapshots/route";
import { getAuthUser } from "@/lib/session";
import { query, queryFirst } from "@/lib/cf/d1";
import { NextRequest } from "next/server";

const mockGetAuthUser = vi.mocked(getAuthUser);
const mockQuery = vi.mocked(query);
const mockQueryFirst = vi.mocked(queryFirst);

function makeRequest(url = "http://localhost/api/snapshots"): NextRequest {
  return new NextRequest(url);
}

const mockUser = {
  id: "user-1",
  email: "test@example.com",
  name: "Test",
  image: null,
};

const mockRows = [
  {
    id: "snap-1",
    hostname: "my-mac",
    platform: "darwin",
    arch: "arm64",
    username: "testuser",
    collector_count: 5,
    file_count: 21,
    list_count: 201,
    size_bytes: 72000,
    snapshot_at: 1709700000000,
    uploaded_at: 1709700100000,
  },
  {
    id: "snap-2",
    hostname: "my-mac",
    platform: "darwin",
    arch: "arm64",
    username: "testuser",
    collector_count: 5,
    file_count: 20,
    list_count: 195,
    size_bytes: 70000,
    snapshot_at: 1709600000000,
    uploaded_at: 1709600100000,
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
    mockQuery.mockResolvedValue([]);
    mockQueryFirst.mockResolvedValue({ total: 0 });

    const response = await GET(makeRequest());
    expect(response.status).toBe(200);
    const data = await response.json();
    expect(data.snapshots).toEqual([]);
    expect(data.total).toBe(0);
    expect(data.nextBefore).toBeNull();
  });

  it("returns snapshots with camelCase fields", async () => {
    mockGetAuthUser.mockResolvedValue(mockUser);
    mockQuery.mockResolvedValue(mockRows);
    mockQueryFirst.mockResolvedValue({ total: 2 });

    const response = await GET(makeRequest());
    expect(response.status).toBe(200);
    const data = await response.json();
    expect(data.snapshots).toHaveLength(2);
    expect(data.snapshots[0]).toEqual({
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
    expect(data.total).toBe(2);
  });

  it("queries only the authenticated user's snapshots", async () => {
    mockGetAuthUser.mockResolvedValue({
      id: "user-42",
      email: "test@example.com",
      name: "Test",
      image: null,
    });
    mockQuery.mockResolvedValue([]);
    mockQueryFirst.mockResolvedValue({ total: 0 });

    await GET(makeRequest());
    expect(mockQuery).toHaveBeenCalledWith(
      expect.stringContaining("WHERE user_id = ?1"),
      ["user-42", 20],
    );
  });

  it("respects custom limit parameter", async () => {
    mockGetAuthUser.mockResolvedValue(mockUser);
    mockQuery.mockResolvedValue([]);
    mockQueryFirst.mockResolvedValue({ total: 0 });

    await GET(makeRequest("http://localhost/api/snapshots?limit=5"));
    expect(mockQuery).toHaveBeenCalledWith(
      expect.stringContaining("LIMIT ?2"),
      ["user-1", 5],
    );
  });

  it("caps limit at 100", async () => {
    mockGetAuthUser.mockResolvedValue(mockUser);
    mockQuery.mockResolvedValue([]);
    mockQueryFirst.mockResolvedValue({ total: 0 });

    await GET(makeRequest("http://localhost/api/snapshots?limit=500"));
    expect(mockQuery).toHaveBeenCalledWith(
      expect.stringContaining("LIMIT ?2"),
      ["user-1", 100],
    );
  });

  it("uses before cursor for pagination", async () => {
    mockGetAuthUser.mockResolvedValue(mockUser);
    mockQuery.mockResolvedValue([]);
    mockQueryFirst.mockResolvedValue({ total: 10 });

    await GET(
      makeRequest("http://localhost/api/snapshots?before=1709700000000"),
    );
    expect(mockQuery).toHaveBeenCalledWith(
      expect.stringContaining("WHERE user_id = ?1 AND uploaded_at < ?2"),
      ["user-1", 1709700000000, 20],
    );
  });

  it("returns nextBefore when results fill the page", async () => {
    mockGetAuthUser.mockResolvedValue(mockUser);
    // Return exactly `limit` rows (default 20) — generate 20 rows
    const twentyRows = Array.from({ length: 20 }, (_, i) => ({
      id: `snap-${i}`,
      hostname: "my-mac",
      platform: "darwin",
      arch: "arm64",
      username: "testuser",
      collector_count: 5,
      file_count: 21,
      list_count: 201,
      size_bytes: 72000,
      snapshot_at: 1709700000000 - i * 100000,
      uploaded_at: 1709700100000 - i * 100000,
    }));
    mockQuery.mockResolvedValue(twentyRows);
    mockQueryFirst.mockResolvedValue({ total: 50 });

    const response = await GET(makeRequest());
    const data = await response.json();
    // biome-ignore lint/style/noNonNullAssertion: test array has known length
    expect(data.nextBefore).toBe(twentyRows[19]!.uploaded_at);
    expect(data.total).toBe(50);
  });

  it("returns nextBefore as null when results do not fill the page", async () => {
    mockGetAuthUser.mockResolvedValue(mockUser);
    mockQuery.mockResolvedValue(mockRows); // 2 rows, default limit is 20
    mockQueryFirst.mockResolvedValue({ total: 2 });

    const response = await GET(makeRequest());
    const data = await response.json();
    expect(data.nextBefore).toBeNull();
  });

  it("ignores invalid limit values", async () => {
    mockGetAuthUser.mockResolvedValue(mockUser);
    mockQuery.mockResolvedValue([]);
    mockQueryFirst.mockResolvedValue({ total: 0 });

    await GET(makeRequest("http://localhost/api/snapshots?limit=abc"));
    expect(mockQuery).toHaveBeenCalledWith(
      expect.any(String),
      ["user-1", 20], // falls back to default
    );
  });
});
