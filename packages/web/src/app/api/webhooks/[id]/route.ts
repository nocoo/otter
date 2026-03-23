import { NextResponse } from "next/server";
import { execute, queryFirst } from "@/lib/cf/d1";
import { getAuthUser } from "@/lib/session";

interface WebhookRow {
  id: string;
  user_id: string;
  token: string;
  label: string;
  is_active: number;
  created_at: number;
  last_used_at: number | null;
}

interface RouteParams {
  params: Promise<{ id: string }>;
}

/** PATCH /api/webhooks/[id] — update label and/or toggle is_active */
export async function PATCH(request: Request, { params }: RouteParams) {
  const user = await getAuthUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;

  try {
    // Verify webhook belongs to user
    const existing = await queryFirst<WebhookRow>(
      `SELECT id, user_id FROM webhooks WHERE id = ?1`,
      [id],
    );

    if (!existing) {
      return NextResponse.json({ error: "Webhook not found" }, { status: 404 });
    }
    if (existing.user_id !== user.id) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    let body: Record<string, unknown>;
    try {
      body = await request.json();
    } catch {
      return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
    }

    // Build dynamic update
    const updates: string[] = [];
    const values: unknown[] = [];
    let paramIndex = 1;

    if (typeof body.label === "string") {
      updates.push(`label = ?${paramIndex}`);
      values.push(body.label.trim().slice(0, 100));
      paramIndex++;
    }

    if (typeof body.isActive === "boolean") {
      updates.push(`is_active = ?${paramIndex}`);
      values.push(body.isActive ? 1 : 0);
      paramIndex++;
    }

    if (updates.length === 0) {
      return NextResponse.json({ error: "No valid fields to update" }, { status: 400 });
    }

    values.push(id);
    await execute(`UPDATE webhooks SET ${updates.join(", ")} WHERE id = ?${paramIndex}`, values);

    // Return updated webhook
    const updated = await queryFirst<WebhookRow>(
      `SELECT id, token, label, is_active, created_at, last_used_at
       FROM webhooks WHERE id = ?1`,
      [id],
    );

    return NextResponse.json({
      webhook: updated
        ? {
            id: updated.id,
            token: updated.token,
            label: updated.label,
            isActive: updated.is_active === 1,
            createdAt: updated.created_at,
            lastUsedAt: updated.last_used_at,
          }
        : null,
    });
  } catch (err) {
    console.error(`PATCH /api/webhooks/${id} failed:`, err);
    return NextResponse.json({ error: "Failed to update webhook in database" }, { status: 500 });
  }
}

/** DELETE /api/webhooks/[id] — delete a webhook */
export async function DELETE(_request: Request, { params }: RouteParams) {
  const user = await getAuthUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;

  try {
    // Verify webhook belongs to user
    const existing = await queryFirst<WebhookRow>(
      `SELECT id, user_id FROM webhooks WHERE id = ?1`,
      [id],
    );

    if (!existing) {
      return NextResponse.json({ error: "Webhook not found" }, { status: 404 });
    }
    if (existing.user_id !== user.id) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    await execute(`DELETE FROM webhooks WHERE id = ?1`, [id]);

    return NextResponse.json({ success: true });
  } catch (err) {
    console.error(`DELETE /api/webhooks/${id} failed:`, err);
    return NextResponse.json({ error: "Failed to delete webhook from database" }, { status: 500 });
  }
}
