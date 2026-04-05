import { NextResponse } from "next/server";
import { getAuthUser } from "@/lib/session";
import { deleteSnapshot, getSnapshot, WorkerError } from "@/lib/worker-client";

interface RouteParams {
  params: Promise<{ id: string }>;
}

/**
 * GET /api/snapshots/[id] — fetch a single snapshot's full data.
 *
 * BFF route: forwards to Worker /v1/snapshots/:id
 */
export async function GET(_request: Request, { params }: RouteParams) {
  const user = await getAuthUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;

  try {
    const result = await getSnapshot(user.id, id);
    return NextResponse.json(result);
  } catch (err) {
    if (err instanceof WorkerError) {
      console.error(`GET /api/snapshots/${id} Worker error:`, err.status, err.body);
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    console.error(`GET /api/snapshots/${id} failed:`, err);
    return NextResponse.json({ error: "Failed to fetch snapshot" }, { status: 500 });
  }
}

/**
 * DELETE /api/snapshots/[id] — delete a snapshot.
 *
 * BFF route: forwards to Worker /v1/snapshots/:id
 */
export async function DELETE(_request: Request, { params }: RouteParams) {
  const user = await getAuthUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;

  try {
    const result = await deleteSnapshot(user.id, id);
    return NextResponse.json(result);
  } catch (err) {
    if (err instanceof WorkerError) {
      console.error(`DELETE /api/snapshots/${id} Worker error:`, err.status, err.body);
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    console.error(`DELETE /api/snapshots/${id} failed:`, err);
    return NextResponse.json({ error: "Failed to delete snapshot" }, { status: 500 });
  }
}
