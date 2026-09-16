import { Hono } from "hono";
import type { Env, Variables } from "../types.js";

// biome-ignore lint/style/useNamingConvention: Hono generic parameter names
export const healthRoutes = new Hono<{ Bindings: Env; Variables: Variables }>();

interface CountRow {
  count: number;
}

/**
 * GET /health — lightweight health check
 *
 * No auth required. No caching.
 * Checks D1 connectivity with a minimal query.
 */
healthRoutes.get("/", async (c) => {
  const start = Date.now();

  // System metadata
  const system = {
    runtime: "cloudflare-workers",
    env: c.env.ENVIRONMENT ?? "production",
  };

  // Check D1 connectivity
  let d1Latency: number | null = null;
  let d1Error: string | null = null;
  let snapshotCount: number | null = null;

  try {
    const d1Start = Date.now();
    const result = await c.env.DB.prepare(
      "SELECT COUNT(*) as count FROM snapshots",
    ).first<CountRow>();
    d1Latency = Date.now() - d1Start;
    snapshotCount = result?.count ?? 0;
  } catch (err) {
    d1Latency = Date.now() - start;
    d1Error = err instanceof Error ? err.message : "D1 connectivity check failed";
  }

  const totalLatency = Date.now() - start;

  if (d1Error) {
    return c.json(
      {
        status: "error",
        checks: {
          d1: { reachable: false, latencyMs: d1Latency, error: d1Error },
        },
        system,
        latencyMs: totalLatency,
      },
      503,
    );
  }

  return c.json({
    status: "ok",
    checks: {
      d1: { reachable: true, latencyMs: d1Latency, snapshots: snapshotCount },
    },
    system,
    latencyMs: totalLatency,
  });
});
