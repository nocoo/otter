import { NextResponse } from "next/server";
import { getAuthUser } from "@/lib/session";
import { query, execute } from "@/lib/cf/d1";

interface WebhookRow {
  id: string;
  user_id: string;
  token: string;
  label: string;
  is_active: number;
  created_at: number;
  last_used_at: number | null;
}

/** GET /api/webhooks — list all webhooks for the authenticated user */
export async function GET() {
  const user = await getAuthUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const rows = await query<WebhookRow>(
      `SELECT id, token, label, is_active, created_at, last_used_at
       FROM webhooks
       WHERE user_id = ?1
       ORDER BY created_at DESC`,
      [user.id],
    );

    const webhooks = rows.map((row) => ({
      id: row.id,
      token: row.token,
      label: row.label,
      isActive: row.is_active === 1,
      createdAt: row.created_at,
      lastUsedAt: row.last_used_at,
    }));

    return NextResponse.json({ webhooks });
  } catch (err) {
    console.error("GET /api/webhooks failed:", err);
    return NextResponse.json(
      { error: "Failed to fetch webhooks from database" },
      { status: 500 },
    );
  }
}

/** POST /api/webhooks — create a new webhook token */
export async function POST(request: Request) {
  const user = await getAuthUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let label = "Default";
  try {
    const body = await request.json();
    if (body.label && typeof body.label === "string") {
      label = body.label.trim().slice(0, 100);
    }
  } catch {
    // Empty body is fine, use default label
  }

  const id = crypto.randomUUID();
  const token = crypto.randomUUID();
  const now = Date.now();

  try {
    await execute(
      `INSERT INTO webhooks (id, user_id, token, label, is_active, created_at)
       VALUES (?1, ?2, ?3, ?4, 1, ?5)`,
      [id, user.id, token, label, now],
    );

    return NextResponse.json(
      {
        webhook: {
          id,
          token,
          label,
          isActive: true,
          createdAt: now,
          lastUsedAt: null,
        },
      },
      { status: 201 },
    );
  } catch (err) {
    console.error("POST /api/webhooks failed:", err);
    return NextResponse.json(
      { error: "Failed to create webhook in database" },
      { status: 500 },
    );
  }
}
