import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@auth/core/jwt", () => ({
  decode: vi.fn(),
}));

vi.mock("../../lib/cf/d1", () => ({
  execute: vi.fn().mockResolvedValue(undefined),
}));

import { decode } from "@auth/core/jwt";
import { Hono } from "hono";
import type { AuthUser } from "../../middleware/auth";

const mockDecode = vi.mocked(decode);

type HonoEnv = { Variables: { user: AuthUser } };

async function buildApp() {
  vi.resetModules();
  const { authMiddleware } = await import("../../middleware/auth");
  const app = new Hono<HonoEnv>();
  app.use("*", authMiddleware);
  app.get("/whoami", (c) => c.json(c.get("user")));
  return app;
}

const ORIGINAL_ENV = { ...process.env };

beforeEach(() => {
  process.env.NODE_ENV = "test";
  process.env.AUTH_SECRET = "test-secret";
  process.env.E2E_SKIP_AUTH = undefined;
  delete process.env.NEXTAUTH_URL;
  delete process.env.USE_SECURE_COOKIES;
  mockDecode.mockReset();
});

afterEach(() => {
  process.env = { ...ORIGINAL_ENV };
});

describe("authMiddleware", () => {
  it("returns 401 when no session cookie present", async () => {
    const app = await buildApp();
    const res = await app.request("/whoami");
    expect(res.status).toBe(401);
  });

  it("decodes a single (non-chunked) cookie", async () => {
    mockDecode.mockResolvedValue({
      sub: "user-1",
      email: "u@example.com",
      name: "User One",
      picture: "https://img/1",
    } as never);
    const app = await buildApp();
    const res = await app.request("/whoami", {
      headers: { cookie: "authjs.session-token=token-value" },
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      id: "user-1",
      email: "u@example.com",
      name: "User One",
      image: "https://img/1",
    });
    expect(mockDecode).toHaveBeenCalledWith({
      token: "token-value",
      secret: "test-secret",
      salt: "authjs.session-token",
    });
  });

  it("reassembles chunked cookies in numeric order regardless of header order", async () => {
    mockDecode.mockResolvedValue({
      sub: "user-2",
      email: "chunk@example.com",
    } as never);
    const app = await buildApp();
    const res = await app.request("/whoami", {
      headers: {
        cookie:
          "authjs.session-token.2=ccc; authjs.session-token.0=aaa; authjs.session-token.1=bbb",
      },
    });
    expect(res.status).toBe(200);
    expect(mockDecode).toHaveBeenCalledWith({
      token: "aaabbbccc",
      secret: "test-secret",
      salt: "authjs.session-token",
    });
  });

  it("ignores non-numeric suffixes when reassembling", async () => {
    mockDecode.mockResolvedValue({ sub: "u", email: "e@x" } as never);
    const app = await buildApp();
    const res = await app.request("/whoami", {
      headers: {
        cookie: "authjs.session-token.0=aaa; authjs.session-token.bogus=zzz",
      },
    });
    expect(res.status).toBe(200);
    expect(mockDecode).toHaveBeenCalledWith(expect.objectContaining({ token: "aaa" }));
  });

  it("returns 401 when decode resolves to null", async () => {
    mockDecode.mockResolvedValue(null as never);
    const app = await buildApp();
    const res = await app.request("/whoami", {
      headers: { cookie: "authjs.session-token=bad" },
    });
    expect(res.status).toBe(401);
  });

  it("returns 401 when decode throws", async () => {
    mockDecode.mockRejectedValue(new Error("boom"));
    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const app = await buildApp();
    const res = await app.request("/whoami", {
      headers: { cookie: "authjs.session-token=bad" },
    });
    expect(res.status).toBe(401);
    consoleSpy.mockRestore();
  });

  it("returns 401 when payload missing userId/email", async () => {
    mockDecode.mockResolvedValue({ sub: "u" } as never);
    const app = await buildApp();
    const res = await app.request("/whoami", {
      headers: { cookie: "authjs.session-token=t" },
    });
    expect(res.status).toBe(401);
  });

  it("prefers payload.userId over payload.sub", async () => {
    mockDecode.mockResolvedValue({
      sub: "sub-id",
      userId: "user-id",
      email: "e@x",
    } as never);
    const app = await buildApp();
    const res = await app.request("/whoami", {
      headers: { cookie: "authjs.session-token=t" },
    });
    expect(await res.json()).toMatchObject({ id: "user-id" });
  });

  it("uses __Secure- prefix when NEXTAUTH_URL is https", async () => {
    process.env.NEXTAUTH_URL = "https://prod.example.com";
    mockDecode.mockResolvedValue({ sub: "u", email: "e@x" } as never);
    const app = await buildApp();
    const res = await app.request("/whoami", {
      headers: { cookie: "__Secure-authjs.session-token=secret" },
    });
    expect(res.status).toBe(200);
    expect(mockDecode).toHaveBeenCalledWith(
      expect.objectContaining({ salt: "__Secure-authjs.session-token" }),
    );
  });

  it("returns 500 when AUTH_SECRET is missing", async () => {
    delete process.env.AUTH_SECRET;
    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const app = await buildApp();
    const res = await app.request("/whoami", {
      headers: { cookie: "authjs.session-token=t" },
    });
    expect(res.status).toBe(500);
    consoleSpy.mockRestore();
  });

  it("E2E_SKIP_AUTH bypasses decode and seeds user", async () => {
    process.env.E2E_SKIP_AUTH = "true";
    const app = await buildApp();
    const res = await app.request("/whoami");
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({
      id: "e2e-test-user",
      email: "e2e@test.local",
    });
    expect(mockDecode).not.toHaveBeenCalled();
  });
});
