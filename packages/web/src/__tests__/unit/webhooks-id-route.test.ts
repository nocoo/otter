import { beforeEach, describe, expect, it, vi } from "vitest";

// Mock dependencies
vi.mock("@/lib/session", () => ({
  getAuthUser: vi.fn(),
}));

vi.mock("@/lib/worker-client", () => ({
  updateWebhook: vi.fn(),
  deleteWebhook: vi.fn(),
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

import { DELETE, PATCH } from "@/app/api/webhooks/[id]/route";
import { getAuthUser } from "@/lib/session";
import { deleteWebhook, updateWebhook, WorkerError } from "@/lib/worker-client";

const mockGetAuthUser = vi.mocked(getAuthUser);
const mockUpdateWebhook = vi.mocked(updateWebhook);
const mockDeleteWebhook = vi.mocked(deleteWebhook);

// Helper to create route params
function makeParams(id: string): { params: Promise<{ id: string }> } {
  return { params: Promise.resolve({ id }) };
}

// Helper to create a mock PATCH Request
function mockPatchRequest(body: unknown): Request {
  return new Request("http://localhost/api/webhooks/test-id", {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

// Helper to create a mock DELETE Request
function mockDeleteRequest(): Request {
  return new Request("http://localhost/api/webhooks/test-id", {
    method: "DELETE",
  });
}

const mockUser = {
  id: "user-1",
  email: "test@example.com",
  name: "Test",
  image: null,
};

const mockWebhook = {
  id: "wh-1",
  token: "tok-abc",
  label: "Test",
  isActive: true,
  createdAt: 1700000000000,
  lastUsedAt: null,
};

describe("PATCH /api/webhooks/[id]", () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it("returns 401 when not authenticated", async () => {
    mockGetAuthUser.mockResolvedValue(null);
    const response = await PATCH(mockPatchRequest({ isActive: false }), makeParams("wh-1"));
    expect(response.status).toBe(401);
  });

  it("returns 400 when body is invalid JSON", async () => {
    mockGetAuthUser.mockResolvedValue(mockUser);

    const response = await PATCH(
      new Request("http://localhost/api/webhooks/wh-1", {
        method: "PATCH",
        body: "not json",
      }),
      makeParams("wh-1"),
    );
    expect(response.status).toBe(400);
    const data = await response.json();
    expect(data.error).toBe("Invalid JSON body");
  });

  it("returns 400 when no valid fields to update", async () => {
    mockGetAuthUser.mockResolvedValue(mockUser);

    const response = await PATCH(mockPatchRequest({ unknownField: "value" }), makeParams("wh-1"));
    expect(response.status).toBe(400);
    const data = await response.json();
    expect(data.error).toBe("No valid fields to update");
  });

  it("returns 404 when webhook not found", async () => {
    mockGetAuthUser.mockResolvedValue(mockUser);
    mockUpdateWebhook.mockRejectedValue(new WorkerError("Webhook not found", 404));

    const response = await PATCH(
      mockPatchRequest({ isActive: false }),
      makeParams("wh-nonexistent"),
    );
    expect(response.status).toBe(404);
    const data = await response.json();
    expect(data.error).toBe("Webhook not found");
  });

  it("returns 403 when webhook belongs to another user", async () => {
    mockGetAuthUser.mockResolvedValue(mockUser);
    mockUpdateWebhook.mockRejectedValue(new WorkerError("Forbidden", 403));

    const response = await PATCH(mockPatchRequest({ isActive: false }), makeParams("wh-1"));
    expect(response.status).toBe(403);
    const data = await response.json();
    expect(data.error).toBe("Forbidden");
  });

  it("updates isActive field", async () => {
    mockGetAuthUser.mockResolvedValue(mockUser);
    mockUpdateWebhook.mockResolvedValue({
      webhook: { ...mockWebhook, isActive: false },
    });

    const response = await PATCH(mockPatchRequest({ isActive: false }), makeParams("wh-1"));
    expect(response.status).toBe(200);
    const data = await response.json();
    expect(data.webhook.isActive).toBe(false);

    expect(mockUpdateWebhook).toHaveBeenCalledWith("user-1", "wh-1", { isActive: false });
  });

  it("updates label field", async () => {
    mockGetAuthUser.mockResolvedValue(mockUser);
    mockUpdateWebhook.mockResolvedValue({
      webhook: { ...mockWebhook, label: "New Label" },
    });

    const response = await PATCH(mockPatchRequest({ label: "New Label" }), makeParams("wh-1"));
    expect(response.status).toBe(200);
    const data = await response.json();
    expect(data.webhook.label).toBe("New Label");

    expect(mockUpdateWebhook).toHaveBeenCalledWith("user-1", "wh-1", { label: "New Label" });
  });

  it("updates both label and isActive", async () => {
    mockGetAuthUser.mockResolvedValue(mockUser);
    mockUpdateWebhook.mockResolvedValue({
      webhook: { ...mockWebhook, label: "Updated", isActive: false },
    });

    const response = await PATCH(
      mockPatchRequest({ label: "Updated", isActive: false }),
      makeParams("wh-1"),
    );
    expect(response.status).toBe(200);

    expect(mockUpdateWebhook).toHaveBeenCalledWith("user-1", "wh-1", {
      label: "Updated",
      isActive: false,
    });
  });

  it("truncates long labels to 100 characters", async () => {
    mockGetAuthUser.mockResolvedValue(mockUser);
    mockUpdateWebhook.mockResolvedValue({
      webhook: { ...mockWebhook, label: "a".repeat(100) },
    });

    const longLabel = "a".repeat(200);
    await PATCH(mockPatchRequest({ label: longLabel }), makeParams("wh-1"));

    expect(mockUpdateWebhook).toHaveBeenCalledWith("user-1", "wh-1", { label: "a".repeat(100) });
  });

  it("handles generic errors", async () => {
    mockGetAuthUser.mockResolvedValue(mockUser);
    mockUpdateWebhook.mockRejectedValue(new Error("Network error"));

    const response = await PATCH(mockPatchRequest({ isActive: false }), makeParams("wh-1"));
    expect(response.status).toBe(500);
    const data = await response.json();
    expect(data.error).toBe("Failed to update webhook");
  });
});

describe("DELETE /api/webhooks/[id]", () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it("returns 401 when not authenticated", async () => {
    mockGetAuthUser.mockResolvedValue(null);
    const response = await DELETE(mockDeleteRequest(), makeParams("wh-1"));
    expect(response.status).toBe(401);
  });

  it("returns 404 when webhook not found", async () => {
    mockGetAuthUser.mockResolvedValue(mockUser);
    mockDeleteWebhook.mockRejectedValue(new WorkerError("Webhook not found", 404));

    const response = await DELETE(mockDeleteRequest(), makeParams("wh-nonexistent"));
    expect(response.status).toBe(404);
    const data = await response.json();
    expect(data.error).toBe("Webhook not found");
  });

  it("returns 403 when webhook belongs to another user", async () => {
    mockGetAuthUser.mockResolvedValue(mockUser);
    mockDeleteWebhook.mockRejectedValue(new WorkerError("Forbidden", 403));

    const response = await DELETE(mockDeleteRequest(), makeParams("wh-1"));
    expect(response.status).toBe(403);
    const data = await response.json();
    expect(data.error).toBe("Forbidden");
  });

  it("deletes webhook successfully", async () => {
    mockGetAuthUser.mockResolvedValue(mockUser);
    mockDeleteWebhook.mockResolvedValue({ success: true });

    const response = await DELETE(mockDeleteRequest(), makeParams("wh-1"));
    expect(response.status).toBe(200);
    const data = await response.json();
    expect(data.success).toBe(true);

    expect(mockDeleteWebhook).toHaveBeenCalledWith("user-1", "wh-1");
  });

  it("handles generic errors", async () => {
    mockGetAuthUser.mockResolvedValue(mockUser);
    mockDeleteWebhook.mockRejectedValue(new Error("Network error"));

    const response = await DELETE(mockDeleteRequest(), makeParams("wh-1"));
    expect(response.status).toBe(500);
    const data = await response.json();
    expect(data.error).toBe("Failed to delete webhook");
  });
});
