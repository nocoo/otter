import { beforeEach, describe, expect, it, vi } from "vitest";

// Mock dependencies
vi.mock("@/lib/session", () => ({
  getAuthUser: vi.fn(),
}));

vi.mock("@/lib/worker-client", () => ({
  listWebhooks: vi.fn(),
  createWebhook: vi.fn(),
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

import { GET, POST } from "@/app/api/webhooks/route";
import { getAuthUser } from "@/lib/session";
import { createWebhook, listWebhooks, WorkerError } from "@/lib/worker-client";

const mockGetAuthUser = vi.mocked(getAuthUser);
const mockListWebhooks = vi.mocked(listWebhooks);
const mockCreateWebhook = vi.mocked(createWebhook);

// Helper to create a mock Request
function mockPostRequest(body: unknown): Request {
  return new Request("http://localhost/api/webhooks", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

const mockUser = {
  id: "user-1",
  email: "test@example.com",
  name: "Test",
  image: null,
};

const mockWebhooks = [
  {
    id: "wh-1",
    token: "tok-abc",
    label: "My Webhook",
    isActive: true,
    createdAt: 1700000000000,
    lastUsedAt: 1700001000000,
  },
  {
    id: "wh-2",
    token: "tok-def",
    label: "Other",
    isActive: false,
    createdAt: 1700002000000,
    lastUsedAt: null,
  },
];

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
    mockGetAuthUser.mockResolvedValue(mockUser);
    mockListWebhooks.mockResolvedValue({ webhooks: [] });

    const response = await GET();
    expect(response.status).toBe(200);
    const data = await response.json();
    expect(data.webhooks).toEqual([]);
  });

  it("returns webhooks from Worker", async () => {
    mockGetAuthUser.mockResolvedValue(mockUser);
    mockListWebhooks.mockResolvedValue({ webhooks: mockWebhooks });

    const response = await GET();
    expect(response.status).toBe(200);
    const data = await response.json();
    expect(data.webhooks).toHaveLength(2);
    expect(data.webhooks[0]).toEqual(mockWebhooks[0]);
    // biome-ignore lint/style/noNonNullAssertion: test array access after known length
    expect(data.webhooks[1]!.isActive).toBe(false);
    // biome-ignore lint/style/noNonNullAssertion: test array access after known length
    expect(data.webhooks[1]!.lastUsedAt).toBeNull();
  });

  it("passes user ID to Worker client", async () => {
    mockGetAuthUser.mockResolvedValue({
      id: "user-42",
      email: "test@example.com",
      name: "Test",
      image: null,
    });
    mockListWebhooks.mockResolvedValue({ webhooks: [] });

    await GET();
    expect(mockListWebhooks).toHaveBeenCalledWith("user-42");
  });

  it("handles Worker errors", async () => {
    mockGetAuthUser.mockResolvedValue(mockUser);
    mockListWebhooks.mockRejectedValue(new WorkerError("Internal error", 500));

    const response = await GET();
    expect(response.status).toBe(500);
    const data = await response.json();
    expect(data.error).toBe("Internal error");
  });

  it("handles generic errors", async () => {
    mockGetAuthUser.mockResolvedValue(mockUser);
    mockListWebhooks.mockRejectedValue(new Error("Network error"));

    const response = await GET();
    expect(response.status).toBe(500);
    const data = await response.json();
    expect(data.error).toBe("Failed to fetch webhooks");
  });
});

describe("POST /api/webhooks", () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it("returns 401 when not authenticated", async () => {
    mockGetAuthUser.mockResolvedValue(null);
    const response = await POST(mockPostRequest({ label: "Test" }));
    expect(response.status).toBe(401);
  });

  it("creates webhook with provided label", async () => {
    mockGetAuthUser.mockResolvedValue(mockUser);
    mockCreateWebhook.mockResolvedValue({
      webhook: {
        id: "generated-id",
        token: "generated-token",
        label: "My MacBook",
        isActive: true,
        createdAt: 1700000000000,
        lastUsedAt: null,
      },
    });

    const response = await POST(mockPostRequest({ label: "My MacBook" }));
    expect(response.status).toBe(201);
    const data = await response.json();
    expect(data.webhook).toEqual({
      id: "generated-id",
      token: "generated-token",
      label: "My MacBook",
      isActive: true,
      createdAt: 1700000000000,
      lastUsedAt: null,
    });
  });

  it("passes label to Worker", async () => {
    mockGetAuthUser.mockResolvedValue(mockUser);
    mockCreateWebhook.mockResolvedValue({
      webhook: {
        id: "id",
        token: "token",
        label: "Test",
        isActive: true,
        createdAt: 1700000000000,
        lastUsedAt: null,
      },
    });

    await POST(mockPostRequest({ label: "Test" }));
    expect(mockCreateWebhook).toHaveBeenCalledWith("user-1", { label: "Test" });
  });

  it("calls Worker without label when none provided", async () => {
    mockGetAuthUser.mockResolvedValue(mockUser);
    mockCreateWebhook.mockResolvedValue({
      webhook: {
        id: "id",
        token: "token",
        label: "Default",
        isActive: true,
        createdAt: 1700000000000,
        lastUsedAt: null,
      },
    });

    await POST(new Request("http://localhost/api/webhooks", { method: "POST" }));
    expect(mockCreateWebhook).toHaveBeenCalledWith("user-1", {});
  });

  it("truncates long labels to 100 characters", async () => {
    mockGetAuthUser.mockResolvedValue(mockUser);
    mockCreateWebhook.mockResolvedValue({
      webhook: {
        id: "id",
        token: "token",
        label: "a".repeat(100),
        isActive: true,
        createdAt: 1700000000000,
        lastUsedAt: null,
      },
    });

    const longLabel = "a".repeat(200);
    await POST(mockPostRequest({ label: longLabel }));
    expect(mockCreateWebhook).toHaveBeenCalledWith("user-1", { label: "a".repeat(100) });
  });

  it("handles Worker errors", async () => {
    mockGetAuthUser.mockResolvedValue(mockUser);
    mockCreateWebhook.mockRejectedValue(new WorkerError("Database error", 500));

    const response = await POST(mockPostRequest({ label: "Test" }));
    expect(response.status).toBe(500);
    const data = await response.json();
    expect(data.error).toBe("Database error");
  });

  it("handles generic errors", async () => {
    mockGetAuthUser.mockResolvedValue(mockUser);
    mockCreateWebhook.mockRejectedValue(new Error("Network error"));

    const response = await POST(mockPostRequest({ label: "Test" }));
    expect(response.status).toBe(500);
    const data = await response.json();
    expect(data.error).toBe("Failed to create webhook");
  });
});
