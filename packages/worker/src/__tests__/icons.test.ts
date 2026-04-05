import { createExecutionContext, env, waitOnExecutionContext } from "cloudflare:test";
import { beforeAll, describe, expect, it } from "vitest";
import app from "../index.js";
import "../test-env.d.js";

interface IconsResponse {
  stored?: number;
  errors?: string[];
  error?: string;
}

const VALID_TOKEN = "test-webhook-token-icons";
const DISABLED_TOKEN = "disabled-webhook-token-icons";

// Valid 12-char hex hash
const VALID_HASH = "abcdef012345";
// Simple 1x1 transparent PNG as base64
const TINY_PNG_BASE64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";

describe("Icons API", () => {
  beforeAll(async () => {
    // Seed test database
    await env.DB.exec(
      "CREATE TABLE IF NOT EXISTS webhooks (id TEXT PRIMARY KEY, user_id TEXT NOT NULL, token TEXT UNIQUE NOT NULL, name TEXT NOT NULL, is_active INTEGER DEFAULT 1, created_at INTEGER NOT NULL, last_used_at INTEGER)",
    );

    // Insert test webhooks
    await env.DB.prepare(
      "INSERT OR REPLACE INTO webhooks (id, user_id, token, name, is_active, created_at) VALUES (?, ?, ?, ?, ?, ?)",
    )
      .bind("webhook-icons-1", "test-user-id", VALID_TOKEN, "Test Webhook Icons", 1, Date.now())
      .run();

    await env.DB.prepare(
      "INSERT OR REPLACE INTO webhooks (id, user_id, token, name, is_active, created_at) VALUES (?, ?, ?, ?, ?, ?)",
    )
      .bind(
        "webhook-icons-2",
        "test-user-id",
        DISABLED_TOKEN,
        "Disabled Webhook Icons",
        0,
        Date.now(),
      )
      .run();
  });

  it("POST /ingest/{token}/icons stores icons successfully", async () => {
    const body = {
      icons: [
        { hash: VALID_HASH, data: TINY_PNG_BASE64 },
        { hash: "fedcba098765", data: TINY_PNG_BASE64 },
      ],
    };

    const req = new Request(`http://localhost/ingest/${VALID_TOKEN}/icons`, {
      method: "POST",
      body: JSON.stringify(body),
      headers: { "Content-Type": "application/json" },
    });
    const ctx = createExecutionContext();
    const res = await app.fetch(req, env, ctx);
    await waitOnExecutionContext(ctx);

    expect(res.status).toBe(200);
    const json = (await res.json()) as IconsResponse;
    expect(json.stored).toBe(2);
    expect(json.errors).toBeUndefined();
  });

  it("POST /ingest/{token}/icons with empty array returns stored: 0", async () => {
    const req = new Request(`http://localhost/ingest/${VALID_TOKEN}/icons`, {
      method: "POST",
      body: JSON.stringify({ icons: [] }),
      headers: { "Content-Type": "application/json" },
    });
    const ctx = createExecutionContext();
    const res = await app.fetch(req, env, ctx);
    await waitOnExecutionContext(ctx);

    expect(res.status).toBe(200);
    const json = (await res.json()) as IconsResponse;
    expect(json.stored).toBe(0);
  });

  it("POST /ingest/{token}/icons with invalid token returns 401", async () => {
    const req = new Request("http://localhost/ingest/invalid-token/icons", {
      method: "POST",
      body: JSON.stringify({ icons: [{ hash: VALID_HASH, data: TINY_PNG_BASE64 }] }),
      headers: { "Content-Type": "application/json" },
    });
    const ctx = createExecutionContext();
    const res = await app.fetch(req, env, ctx);
    await waitOnExecutionContext(ctx);

    expect(res.status).toBe(401);
    const json = (await res.json()) as IconsResponse;
    expect(json.error).toBe("Invalid webhook token");
  });

  it("POST /ingest/{token}/icons with disabled webhook returns 403", async () => {
    const req = new Request(`http://localhost/ingest/${DISABLED_TOKEN}/icons`, {
      method: "POST",
      body: JSON.stringify({ icons: [{ hash: VALID_HASH, data: TINY_PNG_BASE64 }] }),
      headers: { "Content-Type": "application/json" },
    });
    const ctx = createExecutionContext();
    const res = await app.fetch(req, env, ctx);
    await waitOnExecutionContext(ctx);

    expect(res.status).toBe(403);
    const json = (await res.json()) as IconsResponse;
    expect(json.error).toBe("Webhook is disabled");
  });

  it("POST /ingest/{token}/icons with invalid hash returns 400", async () => {
    const req = new Request(`http://localhost/ingest/${VALID_TOKEN}/icons`, {
      method: "POST",
      body: JSON.stringify({ icons: [{ hash: "invalid", data: TINY_PNG_BASE64 }] }),
      headers: { "Content-Type": "application/json" },
    });
    const ctx = createExecutionContext();
    const res = await app.fetch(req, env, ctx);
    await waitOnExecutionContext(ctx);

    expect(res.status).toBe(400);
    const json = (await res.json()) as IconsResponse;
    expect(json.error).toBe("Invalid request body");
  });

  it("POST /ingest/{token}/icons with too many icons returns 400", async () => {
    // Create 501 icons (over limit of 500)
    const icons = Array.from({ length: 501 }, (_, i) => ({
      hash: i.toString(16).padStart(12, "0"),
      data: TINY_PNG_BASE64,
    }));

    const req = new Request(`http://localhost/ingest/${VALID_TOKEN}/icons`, {
      method: "POST",
      body: JSON.stringify({ icons }),
      headers: { "Content-Type": "application/json" },
    });
    const ctx = createExecutionContext();
    const res = await app.fetch(req, env, ctx);
    await waitOnExecutionContext(ctx);

    expect(res.status).toBe(400);
    const json = (await res.json()) as IconsResponse;
    expect(json.error).toContain("Too many icons");
  });

  it("POST /ingest/{token}/icons with oversized icon returns 400", async () => {
    // Create a base64 string that exceeds 150KB
    const largeData = "A".repeat(151_000);

    const req = new Request(`http://localhost/ingest/${VALID_TOKEN}/icons`, {
      method: "POST",
      body: JSON.stringify({ icons: [{ hash: VALID_HASH, data: largeData }] }),
      headers: { "Content-Type": "application/json" },
    });
    const ctx = createExecutionContext();
    const res = await app.fetch(req, env, ctx);
    await waitOnExecutionContext(ctx);

    expect(res.status).toBe(400);
    const json = (await res.json()) as IconsResponse;
    expect(json.error).toContain("exceeds size limit");
  });
});
