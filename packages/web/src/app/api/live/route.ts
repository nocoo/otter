import { NextResponse } from "next/server";
import { queryFirst } from "@/lib/cf/d1";
import { APP_VERSION } from "@/lib/version";

interface CountRow {
  count: number;
}

/**
 * GET /api/live -- lightweight health check for uptime monitors.
 *
 * No auth required. No caching.
 * Checks D1 connectivity with a minimal query and returns system metadata.
 *
 * Returns:
 *   status: "ok"    when all dependencies are reachable
 *   status: "error" when any dependency fails (never includes "ok" in error messages)
 */
export async function GET() {
  const start = Date.now();

  // System metadata (always available, no I/O)
  const system = {
    version: APP_VERSION,
    node: process.versions.node,
    uptime: Math.floor(process.uptime()),
    env: process.env.NODE_ENV ?? "development",
  };

  // Check D1 connectivity with minimal query
  let d1Latency: number | null = null;
  let d1Error: string | null = null;
  let snapshotCount: number | null = null;

  try {
    const d1Start = Date.now();
    const row = await queryFirst<CountRow>(
      "SELECT COUNT(*) as count FROM snapshots",
    );
    d1Latency = Date.now() - d1Start;
    snapshotCount = row?.count ?? 0;
  } catch (err) {
    d1Latency = Date.now() - start;
    d1Error =
      err instanceof Error ? err.message : "D1 connectivity check failed";
  }

  const totalLatency = Date.now() - start;

  if (d1Error) {
    return NextResponse.json(
      {
        status: "error",
        checks: {
          d1: { reachable: false, latencyMs: d1Latency, error: d1Error },
        },
        system,
        latencyMs: totalLatency,
      },
      {
        status: 503,
        headers: {
          "Cache-Control": "no-store, no-cache, must-revalidate",
        },
      },
    );
  }

  return NextResponse.json(
    {
      status: "ok",
      checks: {
        d1: { reachable: true, latencyMs: d1Latency, snapshots: snapshotCount },
      },
      system,
      latencyMs: totalLatency,
    },
    {
      headers: {
        "Cache-Control": "no-store, no-cache, must-revalidate",
      },
    },
  );
}
