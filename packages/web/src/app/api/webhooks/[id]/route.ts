import { NextResponse } from "next/server";
import { getAuthUser } from "@/lib/session";
import { deleteWebhook, updateWebhook, WorkerError } from "@/lib/worker-client";

interface RouteParams {
  params: Promise<{ id: string }>;
}

/**
 * PATCH /api/webhooks/[id] — update label and/or toggle is_active
 *
 * BFF route: forwards to Worker /v1/webhooks/:id
 */
export async function PATCH(request: Request, { params }: RouteParams) {
  const user = await getAuthUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;

  let body: { label?: string; isActive?: boolean };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  // Extract only valid fields
  const data: { label?: string; isActive?: boolean } = {};
  if (typeof body.label === "string") {
    data.label = body.label.trim().slice(0, 100);
  }
  if (typeof body.isActive === "boolean") {
    data.isActive = body.isActive;
  }

  if (Object.keys(data).length === 0) {
    return NextResponse.json({ error: "No valid fields to update" }, { status: 400 });
  }

  try {
    const result = await updateWebhook(user.id, id, data);
    return NextResponse.json(result);
  } catch (err) {
    if (err instanceof WorkerError) {
      console.error(`PATCH /api/webhooks/${id} Worker error:`, err.status, err.body);
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    console.error(`PATCH /api/webhooks/${id} failed:`, err);
    return NextResponse.json({ error: "Failed to update webhook" }, { status: 500 });
  }
}

/**
 * DELETE /api/webhooks/[id] — delete a webhook
 *
 * BFF route: forwards to Worker /v1/webhooks/:id
 */
export async function DELETE(_request: Request, { params }: RouteParams) {
  const user = await getAuthUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;

  try {
    const result = await deleteWebhook(user.id, id);
    return NextResponse.json(result);
  } catch (err) {
    if (err instanceof WorkerError) {
      console.error(`DELETE /api/webhooks/${id} Worker error:`, err.status, err.body);
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    console.error(`DELETE /api/webhooks/${id} failed:`, err);
    return NextResponse.json({ error: "Failed to delete webhook" }, { status: 500 });
  }
}
