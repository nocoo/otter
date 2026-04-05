import { NextResponse } from "next/server";
import { getAuthUser } from "@/lib/session";
import { createWebhook, listWebhooks, WorkerError } from "@/lib/worker-client";

/**
 * GET /api/webhooks — list all webhooks for the authenticated user
 *
 * BFF route: forwards to Worker /v1/webhooks
 */
export async function GET() {
  const user = await getAuthUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const result = await listWebhooks(user.id);
    return NextResponse.json(result);
  } catch (err) {
    if (err instanceof WorkerError) {
      console.error("GET /api/webhooks Worker error:", err.status, err.body);
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    console.error("GET /api/webhooks failed:", err);
    return NextResponse.json({ error: "Failed to fetch webhooks" }, { status: 500 });
  }
}

/**
 * POST /api/webhooks — create a new webhook token
 *
 * BFF route: forwards to Worker /v1/webhooks
 */
export async function POST(request: Request) {
  const user = await getAuthUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // Build options object, only including defined values
  const options: { label?: string } = {};
  try {
    const body = await request.json();
    if (body.label && typeof body.label === "string") {
      options.label = body.label.trim().slice(0, 100);
    }
  } catch {
    // Empty body is fine, use default label
  }

  try {
    const result = await createWebhook(user.id, options);
    return NextResponse.json(result, { status: 201 });
  } catch (err) {
    if (err instanceof WorkerError) {
      console.error("POST /api/webhooks Worker error:", err.status, err.body);
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    console.error("POST /api/webhooks failed:", err);
    return NextResponse.json({ error: "Failed to create webhook" }, { status: 500 });
  }
}
