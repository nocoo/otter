import { type NextRequest, NextResponse } from "next/server";
import { getAuthUser } from "@/lib/session";
import { listSnapshots, WorkerError } from "@/lib/worker-client";

/**
 * GET /api/snapshots — list snapshots for the authenticated user.
 *
 * BFF route: forwards to Worker /v1/snapshots
 *
 * Query params:
 *  - limit  (default 20, max 100)
 *  - before (cursor: uploaded_at timestamp, for pagination)
 */
export async function GET(request: NextRequest) {
  const user = await getAuthUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { searchParams } = request.nextUrl;
  const limitParam = searchParams.get("limit");
  const beforeParam = searchParams.get("before");

  // Build options object, only including defined values
  const options: { limit?: number; before?: number } = {};
  if (limitParam) options.limit = Number.parseInt(limitParam, 10);
  if (beforeParam) options.before = Number.parseInt(beforeParam, 10);

  try {
    const result = await listSnapshots(user.id, options);
    return NextResponse.json(result);
  } catch (err) {
    if (err instanceof WorkerError) {
      console.error("GET /api/snapshots Worker error:", err.status, err.body);
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    console.error("GET /api/snapshots failed:", err);
    return NextResponse.json({ error: "Failed to fetch snapshots" }, { status: 500 });
  }
}
