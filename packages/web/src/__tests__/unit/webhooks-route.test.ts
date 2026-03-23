import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock dependencies
vi.mock("@/lib/session", () => ({
  getAuthUser: vi.fn(),
}));

vi.mock("@/lib/cf/d1", () => ({
  query: vi.fn(),
  execute: vi.fn(),
}));

import { GET, POST } from "@/app/api/webhooks/route";
import { getAuthUser } from "@/lib/session";
import { query, execute } from "@/lib/cf/d1";

const mockGetAuthUser = vi.mocked(getAuthUser);
const mockQuery = vi.mocked(query);
const mockExecute = vi.mocked(execute);

// Helper to create a mock Request
function mockPostRequest(body: unknown): Request {
  return new Request("http://localhost/api/webhooks", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("GET /api/webhooks", () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it("returns 401 when not authenticated", async () => {
    mockGetAuthUser.mockResolvedValue(null);
    const response = await GET();
    expect(response.status).toBe(401);
    const data = await response.json();
    expect(data.error).toBe("Unauthorized");
  });

  it("returns empty list when no webhooks exist", async () => {
    mockGetAuthUser.mockResolvedValue({
      id: "user-1",
      email: "test@example.com",
      name: "Test",
      image: null,
    });
    mockQuery.mockResolvedValue([]);

    const response = await GET();
    expect(response.status).toBe(200);
    const data = await response.json();
    expect(data.webhooks).toEqual([]);
  });

  it("returns webhooks with camelCase fields", async () => {
    mockGetAuthUser.mockResolvedValue({
      id: "user-1",
      email: "test@example.com",
      name: "Test",
      image: null,
    });
    mockQuery.mockResolvedValue([
      {
        id: "wh-1",
        token: "tok-abc",
        label: "My Webhook",
        is_active: 1,
        created_at: 1700000000000,
        last_used_at: 1700001000000,
      },
      {
        id: "wh-2",
        token: "tok-def",
        label: "Other",
        is_active: 0,
        created_at: 1700002000000,
        last_used_at: null,
      },
    ]);

    const response = await GET();
    expect(response.status).toBe(200);
    const data = await response.json();
    expect(data.webhooks).toHaveLength(2);
    expect(data.webhooks[0]).toEqual({
      id: "wh-1",
      token: "tok-abc",
      label: "My Webhook",
      isActive: true,
      createdAt: 1700000000000,
      lastUsedAt: 1700001000000,
    });
    // biome-ignore lint/style/noNonNullAssertion: test array access after known length
    expect(data.webhooks[1]!.isActive).toBe(false);
    // biome-ignore lint/style/noNonNullAssertion: test array access after known length
    expect(data.webhooks[1]!.lastUsedAt).toBeNull();
  });

  it("queries only the authenticated user's webhooks", async () => {
    mockGetAuthUser.mockResolvedValue({
      id: "user-42",
      email: "test@example.com",
      name: "Test",
      image: null,
    });
    mockQuery.mockResolvedValue([]);

    await GET();
    expect(mockQuery).toHaveBeenCalledWith(
      expect.stringContaining("WHERE user_id = ?1"),
      ["user-42"],
    );
  });
});

describe("POST /api/webhooks", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    // Mock crypto.randomUUID for deterministic tests
    vi.spyOn(crypto, "randomUUID")
      .mockReturnValueOnce("generated-id" as `${string}-${string}-${string}-${string}-${string}`)
      .mockReturnValueOnce("generated-token" as `${string}-${string}-${string}-${string}-${string}`);
  });

  it("returns 401 when not authenticated", async () => {
    mockGetAuthUser.mockResolvedValue(null);
    const response = await POST(mockPostRequest({ label: "Test" }));
    expect(response.status).toBe(401);
  });

  it("creates webhook with provided label", async () => {
    mockGetAuthUser.mockResolvedValue({
      id: "user-1",
      email: "test@example.com",
      name: "Test",
      image: null,
    });
    mockExecute.mockResolvedValue({ changes: 1, lastRowId: 1 });

    const response = await POST(mockPostRequest({ label: "My MacBook" }));
    expect(response.status).toBe(201);
    const data = await response.json();
    expect(data.webhook).toEqual({
      id: "generated-id",
      token: "generated-token",
      label: "My MacBook",
      isActive: true,
      createdAt: expect.any(Number),
      lastUsedAt: null,
    });
  });

  it("uses default label when none provided", async () => {
    mockGetAuthUser.mockResolvedValue({
      id: "user-1",
      email: "test@example.com",
      name: "Test",
      image: null,
    });
    mockExecute.mockResolvedValue({ changes: 1, lastRowId: 1 });

    const response = await POST(
      new Request("http://localhost/api/webhooks", { method: "POST" }),
    );
    expect(response.status).toBe(201);
    const data = await response.json();
    expect(data.webhook.label).toBe("Default");
  });

  it("truncates long labels to 100 characters", async () => {
    mockGetAuthUser.mockResolvedValue({
      id: "user-1",
      email: "test@example.com",
      name: "Test",
      image: null,
    });
    mockExecute.mockResolvedValue({ changes: 1, lastRowId: 1 });

    const longLabel = "a".repeat(200);
    const response = await POST(mockPostRequest({ label: longLabel }));
    expect(response.status).toBe(201);
    const data = await response.json();
    expect(data.webhook.label).toHaveLength(100);
  });

  it("inserts into D1 with correct user_id", async () => {
    mockGetAuthUser.mockResolvedValue({
      id: "user-1",
      email: "test@example.com",
      name: "Test",
      image: null,
    });
    mockExecute.mockResolvedValue({ changes: 1, lastRowId: 1 });

    await POST(mockPostRequest({ label: "Test" }));
    expect(mockExecute).toHaveBeenCalledWith(
      expect.stringContaining("INSERT INTO webhooks"),
      ["generated-id", "user-1", "generated-token", "Test", expect.any(Number)],
    );
  });
});
