import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock the auth module
vi.mock("@/auth", () => ({
  auth: vi.fn(),
}));

import { getAuthUser } from "@/lib/session";
import { auth } from "@/auth";

const mockAuth = vi.mocked(auth);

describe("getAuthUser", () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it("returns null when no session exists", async () => {
    mockAuth.mockResolvedValue(null as never);
    const user = await getAuthUser();
    expect(user).toBeNull();
  });

  it("returns null when session has no user", async () => {
    mockAuth.mockResolvedValue({ user: undefined } as never);
    const user = await getAuthUser();
    expect(user).toBeNull();
  });

  it("returns null when user has no id", async () => {
    mockAuth.mockResolvedValue({
      user: { email: "test@example.com", name: "Test", image: null },
    } as never);
    const user = await getAuthUser();
    expect(user).toBeNull();
  });

  it("returns null when user has no email", async () => {
    mockAuth.mockResolvedValue({
      user: { id: "123", name: "Test", image: null },
    } as never);
    const user = await getAuthUser();
    expect(user).toBeNull();
  });

  it("returns user when session is valid", async () => {
    mockAuth.mockResolvedValue({
      user: {
        id: "google-sub-123",
        email: "test@example.com",
        name: "Test User",
        image: "https://example.com/avatar.jpg",
      },
    } as never);
    const user = await getAuthUser();
    expect(user).toEqual({
      id: "google-sub-123",
      email: "test@example.com",
      name: "Test User",
      image: "https://example.com/avatar.jpg",
    });
  });

  it("returns null name and image when not provided", async () => {
    mockAuth.mockResolvedValue({
      user: {
        id: "google-sub-123",
        email: "test@example.com",
      },
    } as never);
    const user = await getAuthUser();
    expect(user).toEqual({
      id: "google-sub-123",
      email: "test@example.com",
      name: null,
      image: null,
    });
  });
});
