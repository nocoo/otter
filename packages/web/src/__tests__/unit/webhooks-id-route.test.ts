import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock dependencies
vi.mock("@/lib/session", () => ({
  getAuthUser: vi.fn(),
}));

vi.mock("@/lib/cf/d1", () => ({
  queryFirst: vi.fn(),
  execute: vi.fn(),
}));

import { PATCH, DELETE } from "@/app/api/webhooks/[id]/route";
import { getAuthUser } from "@/lib/session";
import { queryFirst, execute } from "@/lib/cf/d1";

const mockGetAuthUser = vi.mocked(getAuthUser);
const mockQueryFirst = vi.mocked(queryFirst);
const mockExecute = vi.mocked(execute);

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

describe("PATCH /api/webhooks/[id]", () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it("returns 401 when not authenticated", async () => {
    mockGetAuthUser.mockResolvedValue(null);
    const response = await PATCH(
      mockPatchRequest({ isActive: false }),
      makeParams("wh-1"),
    );
    expect(response.status).toBe(401);
  });

  it("returns 404 when webhook not found", async () => {
    mockGetAuthUser.mockResolvedValue({
      id: "user-1",
      email: "test@example.com",
      name: "Test",
      image: null,
    });
    mockQueryFirst.mockResolvedValue(null);

    const response = await PATCH(
      mockPatchRequest({ isActive: false }),
      makeParams("wh-nonexistent"),
    );
    expect(response.status).toBe(404);
  });

  it("returns 403 when webhook belongs to another user", async () => {
    mockGetAuthUser.mockResolvedValue({
      id: "user-1",
      email: "test@example.com",
      name: "Test",
      image: null,
    });
    mockQueryFirst.mockResolvedValue({ id: "wh-1", user_id: "user-other" });

    const response = await PATCH(
      mockPatchRequest({ isActive: false }),
      makeParams("wh-1"),
    );
    expect(response.status).toBe(403);
  });

  it("returns 400 when body is invalid JSON", async () => {
    mockGetAuthUser.mockResolvedValue({
      id: "user-1",
      email: "test@example.com",
      name: "Test",
      image: null,
    });
    mockQueryFirst.mockResolvedValue({ id: "wh-1", user_id: "user-1" });

    const response = await PATCH(
      new Request("http://localhost/api/webhooks/wh-1", {
        method: "PATCH",
        body: "not json",
      }),
      makeParams("wh-1"),
    );
    expect(response.status).toBe(400);
  });

  it("returns 400 when no valid fields to update", async () => {
    mockGetAuthUser.mockResolvedValue({
      id: "user-1",
      email: "test@example.com",
      name: "Test",
      image: null,
    });
    mockQueryFirst.mockResolvedValue({ id: "wh-1", user_id: "user-1" });

    const response = await PATCH(
      mockPatchRequest({ unknownField: "value" }),
      makeParams("wh-1"),
    );
    expect(response.status).toBe(400);
  });

  it("updates isActive field", async () => {
    mockGetAuthUser.mockResolvedValue({
      id: "user-1",
      email: "test@example.com",
      name: "Test",
      image: null,
    });
    // First call: ownership check, second call: return updated
    mockQueryFirst
      .mockResolvedValueOnce({ id: "wh-1", user_id: "user-1" })
      .mockResolvedValueOnce({
        id: "wh-1",
        token: "tok-abc",
        label: "Test",
        is_active: 0,
        created_at: 1700000000000,
        last_used_at: null,
      });
    mockExecute.mockResolvedValue({ changes: 1, lastRowId: 0 });

    const response = await PATCH(
      mockPatchRequest({ isActive: false }),
      makeParams("wh-1"),
    );
    expect(response.status).toBe(200);
    const data = await response.json();
    expect(data.webhook.isActive).toBe(false);

    // Verify the SQL updates the correct field
    expect(mockExecute).toHaveBeenCalledWith(
      expect.stringContaining("is_active"),
      [0, "wh-1"],
    );
  });

  it("updates label field", async () => {
    mockGetAuthUser.mockResolvedValue({
      id: "user-1",
      email: "test@example.com",
      name: "Test",
      image: null,
    });
    mockQueryFirst
      .mockResolvedValueOnce({ id: "wh-1", user_id: "user-1" })
      .mockResolvedValueOnce({
        id: "wh-1",
        token: "tok-abc",
        label: "New Label",
        is_active: 1,
        created_at: 1700000000000,
        last_used_at: null,
      });
    mockExecute.mockResolvedValue({ changes: 1, lastRowId: 0 });

    const response = await PATCH(
      mockPatchRequest({ label: "New Label" }),
      makeParams("wh-1"),
    );
    expect(response.status).toBe(200);
    const data = await response.json();
    expect(data.webhook.label).toBe("New Label");
  });

  it("updates both label and isActive", async () => {
    mockGetAuthUser.mockResolvedValue({
      id: "user-1",
      email: "test@example.com",
      name: "Test",
      image: null,
    });
    mockQueryFirst
      .mockResolvedValueOnce({ id: "wh-1", user_id: "user-1" })
      .mockResolvedValueOnce({
        id: "wh-1",
        token: "tok-abc",
        label: "Updated",
        is_active: 0,
        created_at: 1700000000000,
        last_used_at: null,
      });
    mockExecute.mockResolvedValue({ changes: 1, lastRowId: 0 });

    const response = await PATCH(
      mockPatchRequest({ label: "Updated", isActive: false }),
      makeParams("wh-1"),
    );
    expect(response.status).toBe(200);

    // Verify both fields in the SQL
    expect(mockExecute).toHaveBeenCalledWith(
      expect.stringMatching(/label.*is_active/),
      ["Updated", 0, "wh-1"],
    );
  });
});

describe("DELETE /api/webhooks/[id]", () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it("returns 401 when not authenticated", async () => {
    mockGetAuthUser.mockResolvedValue(null);
    const response = await DELETE(
      mockDeleteRequest(),
      makeParams("wh-1"),
    );
    expect(response.status).toBe(401);
  });

  it("returns 404 when webhook not found", async () => {
    mockGetAuthUser.mockResolvedValue({
      id: "user-1",
      email: "test@example.com",
      name: "Test",
      image: null,
    });
    mockQueryFirst.mockResolvedValue(null);

    const response = await DELETE(
      mockDeleteRequest(),
      makeParams("wh-nonexistent"),
    );
    expect(response.status).toBe(404);
  });

  it("returns 403 when webhook belongs to another user", async () => {
    mockGetAuthUser.mockResolvedValue({
      id: "user-1",
      email: "test@example.com",
      name: "Test",
      image: null,
    });
    mockQueryFirst.mockResolvedValue({ id: "wh-1", user_id: "user-other" });

    const response = await DELETE(
      mockDeleteRequest(),
      makeParams("wh-1"),
    );
    expect(response.status).toBe(403);
  });

  it("deletes webhook successfully", async () => {
    mockGetAuthUser.mockResolvedValue({
      id: "user-1",
      email: "test@example.com",
      name: "Test",
      image: null,
    });
    mockQueryFirst.mockResolvedValue({ id: "wh-1", user_id: "user-1" });
    mockExecute.mockResolvedValue({ changes: 1, lastRowId: 0 });

    const response = await DELETE(
      mockDeleteRequest(),
      makeParams("wh-1"),
    );
    expect(response.status).toBe(200);
    const data = await response.json();
    expect(data.success).toBe(true);

    expect(mockExecute).toHaveBeenCalledWith(
      expect.stringContaining("DELETE FROM webhooks"),
      ["wh-1"],
    );
  });
});
