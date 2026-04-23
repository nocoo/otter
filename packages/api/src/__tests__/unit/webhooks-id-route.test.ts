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

import { createApp } from "../../app.js";

const app = createApp();

import { deleteWebhook, updateWebhook, WorkerError } from "../../lib/worker-client.js";

const { __setUser } = (await import("../../middleware/auth.js")) as any;

const mockUpdateWebhook = vi.mocked(updateWebhook);
const mockDeleteWebhook = vi.mocked(deleteWebhook);

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

function patchJson(body: unknown): RequestInit {
  return {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  };
}

describe("PATCH /v1/webhooks/:id", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    __setUser(mockUser);
  });

  it("returns 401 when not authenticated", async () => {
    __setUser(null);
    const res = await app.request("/v1/webhooks/wh-1", patchJson({ isActive: false }));
    expect(res.status).toBe(401);
  });

  it("returns 400 when body is invalid JSON", async () => {
    const res = await app.request("/v1/webhooks/wh-1", {
      method: "PATCH",
      body: "not json",
    });
    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data.error).toBe("Invalid JSON body");
  });

  it("returns 400 when no valid fields to update", async () => {
    const res = await app.request("/v1/webhooks/wh-1", patchJson({ unknownField: "value" }));
    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data.error).toBe("No valid fields to update");
  });

  it("returns 404 when webhook not found", async () => {
    mockUpdateWebhook.mockRejectedValue(new WorkerError("Webhook not found", 404));
    const res = await app.request("/v1/webhooks/wh-nonexistent", patchJson({ isActive: false }));
    expect(res.status).toBe(404);
    const data = await res.json();
    expect(data.error).toBe("Webhook not found");
  });

  it("returns 403 when webhook belongs to another user", async () => {
    mockUpdateWebhook.mockRejectedValue(new WorkerError("Forbidden", 403));
    const res = await app.request("/v1/webhooks/wh-1", patchJson({ isActive: false }));
    expect(res.status).toBe(403);
    const data = await res.json();
    expect(data.error).toBe("Forbidden");
  });

  it("updates isActive field", async () => {
    mockUpdateWebhook.mockResolvedValue({ webhook: { ...mockWebhook, isActive: false } });
    const res = await app.request("/v1/webhooks/wh-1", patchJson({ isActive: false }));
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.webhook.isActive).toBe(false);
    expect(mockUpdateWebhook).toHaveBeenCalledWith("user-1", "wh-1", { isActive: false });
  });

  it("updates label field", async () => {
    mockUpdateWebhook.mockResolvedValue({ webhook: { ...mockWebhook, label: "New Label" } });
    const res = await app.request("/v1/webhooks/wh-1", patchJson({ label: "New Label" }));
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.webhook.label).toBe("New Label");
    expect(mockUpdateWebhook).toHaveBeenCalledWith("user-1", "wh-1", { label: "New Label" });
  });

  it("updates both label and isActive", async () => {
    mockUpdateWebhook.mockResolvedValue({
      webhook: { ...mockWebhook, label: "Updated", isActive: false },
    });
    const res = await app.request(
      "/v1/webhooks/wh-1",
      patchJson({ label: "Updated", isActive: false }),
    );
    expect(res.status).toBe(200);
    expect(mockUpdateWebhook).toHaveBeenCalledWith("user-1", "wh-1", {
      label: "Updated",
      isActive: false,
    });
  });

  it("truncates long labels to 100 characters", async () => {
    mockUpdateWebhook.mockResolvedValue({ webhook: { ...mockWebhook, label: "a".repeat(100) } });
    const longLabel = "a".repeat(200);
    await app.request("/v1/webhooks/wh-1", patchJson({ label: longLabel }));
    expect(mockUpdateWebhook).toHaveBeenCalledWith("user-1", "wh-1", { label: "a".repeat(100) });
  });

  it("handles generic errors", async () => {
    mockUpdateWebhook.mockRejectedValue(new Error("Network error"));
    const res = await app.request("/v1/webhooks/wh-1", patchJson({ isActive: false }));
    expect(res.status).toBe(500);
    const data = await res.json();
    expect(data.error).toBe("Failed to update webhook");
  });
});

describe("DELETE /v1/webhooks/:id", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    __setUser(mockUser);
  });

  it("returns 401 when not authenticated", async () => {
    __setUser(null);
    const res = await app.request("/v1/webhooks/wh-1", { method: "DELETE" });
    expect(res.status).toBe(401);
  });

  it("returns 404 when webhook not found", async () => {
    mockDeleteWebhook.mockRejectedValue(new WorkerError("Webhook not found", 404));
    const res = await app.request("/v1/webhooks/wh-nonexistent", { method: "DELETE" });
    expect(res.status).toBe(404);
    const data = await res.json();
    expect(data.error).toBe("Webhook not found");
  });

  it("returns 403 when webhook belongs to another user", async () => {
    mockDeleteWebhook.mockRejectedValue(new WorkerError("Forbidden", 403));
    const res = await app.request("/v1/webhooks/wh-1", { method: "DELETE" });
    expect(res.status).toBe(403);
    const data = await res.json();
    expect(data.error).toBe("Forbidden");
  });

  it("deletes webhook successfully", async () => {
    mockDeleteWebhook.mockResolvedValue({ success: true });
    const res = await app.request("/v1/webhooks/wh-1", { method: "DELETE" });
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.success).toBe(true);
    expect(mockDeleteWebhook).toHaveBeenCalledWith("user-1", "wh-1");
  });

  it("handles generic errors", async () => {
    mockDeleteWebhook.mockRejectedValue(new Error("Network error"));
    const res = await app.request("/v1/webhooks/wh-1", { method: "DELETE" });
    expect(res.status).toBe(500);
    const data = await res.json();
    expect(data.error).toBe("Failed to delete webhook");
  });
});
