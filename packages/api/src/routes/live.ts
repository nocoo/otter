import { type Context, Hono } from "hono";
import type { AppEnv } from "../lib/app-env";
import { queryFirst as httpQueryFirst } from "../lib/cf/d1";
import { APP_VERSION } from "../lib/version";

interface CountRow {
  count: number;
}

const app = new Hono<AppEnv>();

function fetchSnapshotCount(c: Context<AppEnv>): Promise<CountRow | null> {
  const driver = c.get("driver");
  if (driver) {
    return driver.queryFirst<CountRow>("SELECT COUNT(*) as count FROM snapshots");
  }
  return httpQueryFirst<CountRow>("SELECT COUNT(*) as count FROM snapshots");
}

app.get("/", async (c) => {
  const start = Date.now();

  // biome-ignore lint/style/useNamingConvention: env var name from wrangler.toml
  const wEnv = (c.env ?? {}) as { ENVIRONMENT?: string };
  const system = {
    version: APP_VERSION,
    node: process.versions.node,
    uptime: Math.floor(process.uptime()),
    env: wEnv.ENVIRONMENT ?? process.env.NODE_ENV ?? "development",
  };

  let d1Latency: number | null = null;
  let d1Error: string | null = null;
  let snapshotCount: number | null = null;

  try {
    const d1Start = Date.now();
    const row = await fetchSnapshotCount(c);
    d1Latency = Date.now() - d1Start;
    snapshotCount = row?.count ?? 0;
  } catch (err) {
    d1Latency = Date.now() - start;
    d1Error = err instanceof Error ? err.message : "D1 connectivity check failed";
  }

  const totalLatency = Date.now() - start;

  c.header("Cache-Control", "no-store, no-cache, must-revalidate");

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

export default app;
