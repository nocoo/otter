import { describe, expect, it } from "vitest";

import {
  type ApiTokenRow,
  createApiToken,
  generateRawToken,
  hashToken,
  listApiTokensByEmail,
  revokeApiToken,
  touchApiTokenLastUsed,
  verifyApiToken,
} from "../../lib/api-token-repo";
import { createMockDriver } from "./_mock-driver";

describe("hashToken", () => {
  it("is deterministic SHA-256 hex", async () => {
    const a = await hashToken("hello");
    const b = await hashToken("hello");
    expect(a).toBe(b);
    expect(a).toMatch(/^[0-9a-f]{64}$/);
  });

  it("differs for different inputs", async () => {
    expect(await hashToken("a")).not.toBe(await hashToken("b"));
  });
});

describe("generateRawToken", () => {
  it("produces otk_-prefixed base64url tokens", () => {
    const t = generateRawToken();
    expect(t.startsWith("otk_")).toBe(true);
    expect(t.slice(4)).toMatch(/^[A-Za-z0-9_-]+$/);
  });

  it("is unique per call", () => {
    const a = generateRawToken();
    const b = generateRawToken();
    expect(a).not.toBe(b);
  });
});

describe("createApiToken", () => {
  it("inserts hashed token and returns raw + public row", async () => {
    const { driver, calls } = createMockDriver();
    const result = await createApiToken(driver, {
      email: "u@example.com",
      id: "id-1",
      now: 1000,
    });

    expect(result.token.startsWith("otk_")).toBe(true);
    expect(result.row).toEqual({
      id: "id-1",
      tokenPrefix: result.token.slice(0, 12),
      email: "u@example.com",
      label: "CLI",
      createdAt: 1000,
      lastUsedAt: null,
      expiresAt: null,
    });

    const insert = calls[0];
    expect(insert?.method).toBe("execute");
    expect(insert?.sql).toContain("INSERT INTO api_tokens");
    const params = insert?.params ?? [];
    expect(params[0]).toBe("id-1");
    expect(params[1]).toBe(await hashToken(result.token));
    expect(params[3]).toBe("u@example.com");
    expect(params[4]).toBe("CLI");
    expect(params[5]).toBe(1000);
    expect(params[6]).toBe(null);
  });

  it("uses provided label and expiresAt", async () => {
    const { driver } = createMockDriver();
    const result = await createApiToken(driver, {
      email: "u@example.com",
      label: "macbook",
      expiresAt: 9999,
      id: "id-2",
      now: 500,
    });
    expect(result.row.label).toBe("macbook");
    expect(result.row.expiresAt).toBe(9999);
  });
});

describe("verifyApiToken", () => {
  it("returns null for empty input", async () => {
    const { driver } = createMockDriver();
    expect(await verifyApiToken(driver, "")).toBeNull();
  });

  it("returns id+email when hash matches and not expired", async () => {
    const raw = "otk_test";
    const hash = await hashToken(raw);
    const row: Partial<ApiTokenRow> = {
      id: "tok-1",
      token_hash: hash,
      email: "u@example.com",
    };
    const { driver } = createMockDriver({
      responses: [{ match: "FROM api_tokens", rows: [row] }],
    });
    const v = await verifyApiToken(driver, raw, 100);
    expect(v).toEqual({ id: "tok-1", email: "u@example.com" });
  });

  it("returns null when no row matches", async () => {
    const { driver } = createMockDriver();
    expect(await verifyApiToken(driver, "otk_missing")).toBeNull();
  });
});

describe("touchApiTokenLastUsed", () => {
  it("issues UPDATE with now + id", async () => {
    const { driver, calls } = createMockDriver();
    await touchApiTokenLastUsed(driver, "tok-1", 12345);
    expect(calls[0]?.sql).toContain("UPDATE api_tokens SET last_used_at");
    expect(calls[0]?.params).toEqual([12345, "tok-1"]);
  });
});

describe("listApiTokensByEmail", () => {
  it("returns mapped public rows", async () => {
    const row: ApiTokenRow = {
      id: "tok-1",
      token_hash: "h",
      token_prefix: "otk_aaaa",
      email: "u@example.com",
      label: "CLI",
      created_at: 1,
      last_used_at: null,
      expires_at: null,
    };
    const { driver, calls } = createMockDriver({
      responses: [{ match: "FROM api_tokens", rows: [row] }],
    });
    const out = await listApiTokensByEmail(driver, "u@example.com");
    expect(out).toEqual([
      {
        id: "tok-1",
        tokenPrefix: "otk_aaaa",
        email: "u@example.com",
        label: "CLI",
        createdAt: 1,
        lastUsedAt: null,
        expiresAt: null,
      },
    ]);
    expect(calls[0]?.params).toEqual(["u@example.com"]);
  });
});

describe("revokeApiToken", () => {
  it("returns true when changes > 0", async () => {
    const { driver } = createMockDriver({ executeMeta: { changes: 1, lastRowId: 0 } });
    expect(await revokeApiToken(driver, "tok-1")).toBe(true);
  });

  it("returns false when nothing deleted", async () => {
    const { driver } = createMockDriver({ executeMeta: { changes: 0, lastRowId: 0 } });
    expect(await revokeApiToken(driver, "tok-x")).toBe(false);
  });
});
