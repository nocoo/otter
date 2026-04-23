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

import app from "../../app.js";
import { createWebhook, listWebhooks, WorkerError } from "../../lib/worker-client.js";

const { __setUser } = (await import("../../middleware/auth.js")) as any;

const mockListWebhooks = vi.mocked(listWebhooks);
const mockCreateWebhook = vi.mocked(createWebhook);

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

function postJson(body: unknown): RequestInit {
  return {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  };
}

describe("GET /v1/webhooks", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    __setUser(mockUser);
  });

  it("returns 401 when not authenticated", async () => {
    __setUser(null);
    const res = await app.request("/v1/webhooks");
    expect(res.status).toBe(401);
    const data = await res.json();
    expect(data.error).toBe("Unauthorized");
  });

  it("returns empty list when no webhooks exist", async () => {
    mockListWebhooks.mockResolvedValue({ webhooks: [] });
    const res = await app.request("/v1/webhooks");
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.webhooks).toEqual([]);
  });

  it("returns webhooks from Worker", async () => {
    mockListWebhooks.mockResolvedValue({ webhooks: mockWebhooks });
    const res = await app.request("/v1/webhooks");
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.webhooks).toHaveLength(2);
    expect(data.webhooks[0]).toEqual(mockWebhooks[0]);
    expect(data.webhooks[1].isActive).toBe(false);
    expect(data.webhooks[1].lastUsedAt).toBeNull();
  });

  it("passes user ID to Worker client", async () => {
    __setUser({ id: "user-42", email: "test@example.com", name: "Test", image: null });
    mockListWebhooks.mockResolvedValue({ webhooks: [] });
    await app.request("/v1/webhooks");
    expect(mockListWebhooks).toHaveBeenCalledWith("user-42");
  });

  it("handles Worker errors", async () => {
    mockListWebhooks.mockRejectedValue(new WorkerError("Internal error", 500));
    const res = await app.request("/v1/webhooks");
    expect(res.status).toBe(500);
    const data = await res.json();
    expect(data.error).toBe("Internal error");
  });

  it("handles generic errors", async () => {
    mockListWebhooks.mockRejectedValue(new Error("Network error"));
    const res = await app.request("/v1/webhooks");
    expect(res.status).toBe(500);
    const data = await res.json();
    expect(data.error).toBe("Failed to fetch webhooks");
  });
});

describe("POST /v1/webhooks", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    __setUser(mockUser);
  });

  it("returns 401 when not authenticated", async () => {
    __setUser(null);
    const res = await app.request("/v1/webhooks", postJson({ label: "Test" }));
    expect(res.status).toBe(401);
  });

  it("creates webhook with provided label", async () => {
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
    const res = await app.request("/v1/webhooks", postJson({ label: "My MacBook" }));
    expect(res.status).toBe(201);
    const data = await res.json();
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
    await app.request("/v1/webhooks", postJson({ label: "Test" }));
    expect(mockCreateWebhook).toHaveBeenCalledWith("user-1", { label: "Test" });
  });

  it("calls Worker without label when none provided", async () => {
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
    await app.request("/v1/webhooks", { method: "POST" });
    expect(mockCreateWebhook).toHaveBeenCalledWith("user-1", {});
  });

  it("truncates long labels to 100 characters", async () => {
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
    await app.request("/v1/webhooks", postJson({ label: longLabel }));
    expect(mockCreateWebhook).toHaveBeenCalledWith("user-1", { label: "a".repeat(100) });
  });

  it("handles Worker errors", async () => {
    mockCreateWebhook.mockRejectedValue(new WorkerError("Database error", 500));
    const res = await app.request("/v1/webhooks", postJson({ label: "Test" }));
    expect(res.status).toBe(500);
    const data = await res.json();
    expect(data.error).toBe("Database error");
  });

  it("handles generic errors", async () => {
    mockCreateWebhook.mockRejectedValue(new Error("Network error"));
    const res = await app.request("/v1/webhooks", postJson({ label: "Test" }));
    expect(res.status).toBe(500);
    const data = await res.json();
    expect(data.error).toBe("Failed to create webhook");
  });
});
