import { applyD1Migrations, createExecutionContext, waitOnExecutionContext } from "cloudflare:test";
import { env } from "cloudflare:workers";
import { beforeAll, describe, expect, it } from "vitest";
import app from "../index.js";
import "../test-env.d.js";

interface HealthResponse {
  status: string;
  checks: {
    d1: {
      reachable: boolean;
      latencyMs: number;
      snapshots?: number;
      error?: string;
    };
  };
  system: {
    runtime: string;
    env: string;
  };
  latencyMs: number;
}

describe("Health API", () => {
  beforeAll(async () => {
    await applyD1Migrations(env.DB, env.TEST_MIGRATIONS);
    await env.DB.prepare("INSERT OR IGNORE INTO users (id, email) VALUES (?1, ?1)")
      .bind("test-user")
      .run();
  });

  it("GET /health returns ok when D1 is reachable", async () => {
    const req = new Request("http://localhost/health");
    const ctx = createExecutionContext();
    const res = await app.fetch(req, env, ctx);
    await waitOnExecutionContext(ctx);

    expect(res.status).toBe(200);

    const body = (await res.json()) as HealthResponse;
    expect(body.status).toBe("ok");
    expect(body.checks.d1.reachable).toBe(true);
    expect(typeof body.checks.d1.latencyMs).toBe("number");
    expect(typeof body.checks.d1.snapshots).toBe("number");
    expect(body.system.runtime).toBe("cloudflare-workers");
    expect(body.system.env).toBe("test");
    expect(typeof body.latencyMs).toBe("number");
  });

  it("GET /health includes snapshot count", async () => {
    // Insert a test snapshot
    await env.DB.prepare(
      "INSERT INTO snapshots (id, user_id, webhook_id, hostname, platform, arch, username, collector_count, file_count, list_count, size_bytes, r2_key, snapshot_at, uploaded_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
    )
      .bind(
        "test-snap-1",
        "test-user",
        null,
        "test-host",
        "darwin",
        "arm64",
        "testuser",
        5,
        10,
        100,
        1024,
        "test/key.json",
        1712345678000,
        1712345678000,
      )
      .run();

    const req = new Request("http://localhost/health");
    const ctx = createExecutionContext();
    const res = await app.fetch(req, env, ctx);
    await waitOnExecutionContext(ctx);

    expect(res.status).toBe(200);

    const body = (await res.json()) as HealthResponse;
    expect(body.checks.d1.snapshots).toBeGreaterThanOrEqual(1);
  });
});
