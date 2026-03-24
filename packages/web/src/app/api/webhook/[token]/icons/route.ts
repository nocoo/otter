import { NextResponse } from "next/server";
import { queryFirst } from "@/lib/cf/d1";
import { putIcon } from "@/lib/cf/r2";

const ICON_HASH_PATTERN = /^[a-f0-9]{12}$/;

interface WebhookRow {
  id: string;
  // biome-ignore lint/style/useNamingConvention: D1 column name
  user_id: string;
  token: string;
  // biome-ignore lint/style/useNamingConvention: D1 column name
  is_active: number;
}

interface IconPayload {
  hash: string;
  data: string; // base64-encoded PNG
}

interface IconsRequestBody {
  icons: IconPayload[];
}

interface RouteParams {
  params: Promise<{ token: string }>;
}

/**
 * Validate the request body shape.
 * Each icon must have a 12-char hex hash and a non-empty base64 data string.
 */
function isValidBody(data: unknown): data is IconsRequestBody {
  if (typeof data !== "object" || data === null) return false;
  const obj = data as Record<string, unknown>;
  if (!Array.isArray(obj.icons)) return false;

  for (const icon of obj.icons) {
    if (typeof icon !== "object" || icon === null) return false;
    const i = icon as Record<string, unknown>;
    if (typeof i.hash !== "string" || !ICON_HASH_PATTERN.test(i.hash)) return false;
    if (typeof i.data !== "string" || i.data.length === 0) return false;
  }

  return true;
}

/** Maximum number of icons per request */
const MAX_ICONS_PER_REQUEST = 500;

/** Maximum size per icon (100KB base64 ~ 75KB binary) */
const MAX_ICON_BASE64_SIZE = 150_000;

/** POST /api/webhook/[token]/icons — receive app icons from CLI */
export async function POST(request: Request, { params }: RouteParams) {
  const { token } = await params;

  // 1. Validate webhook token
  const webhook = await queryFirst<WebhookRow>(
    `SELECT id, user_id, token, is_active FROM webhooks WHERE token = ?1`,
    [token],
  );

  if (!webhook) {
    return NextResponse.json({ error: "Invalid webhook token" }, { status: 401 });
  }

  if (webhook.is_active !== 1) {
    return NextResponse.json({ error: "Webhook is disabled" }, { status: 403 });
  }

  // 2. Parse and validate body
  let body: IconsRequestBody;
  try {
    const parsed: unknown = await request.json();
    if (!isValidBody(parsed)) {
      return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
    }
    body = parsed;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  if (body.icons.length === 0) {
    return NextResponse.json({ stored: 0 }, { status: 200 });
  }

  if (body.icons.length > MAX_ICONS_PER_REQUEST) {
    return NextResponse.json(
      { error: `Too many icons (max ${MAX_ICONS_PER_REQUEST})` },
      { status: 400 },
    );
  }

  // 3. Validate individual icon sizes
  for (const icon of body.icons) {
    if (icon.data.length > MAX_ICON_BASE64_SIZE) {
      return NextResponse.json({ error: `Icon ${icon.hash} exceeds size limit` }, { status: 400 });
    }
  }

  // 4. Store icons in R2 (independent uploads, run in parallel)
  const errors: string[] = [];

  const results = await Promise.all(
    body.icons.map(async (icon) => {
      try {
        const buffer = Buffer.from(icon.data, "base64");
        await putIcon(icon.hash, buffer);
        return true;
      } catch (error) {
        console.error(`[icons] Failed to store icon ${icon.hash}:`, error);
        errors.push(icon.hash);
        return false;
      }
    }),
  );

  const stored = results.filter(Boolean).length;

  return NextResponse.json(
    {
      stored,
      ...(errors.length > 0 ? { errors } : {}),
    },
    { status: errors.length > 0 ? 207 : 200 },
  );
}
