import { Hono } from "hono";
import { iconKey, putIcon } from "../services/icon.js";
import { validateWebhookToken } from "../services/webhook.js";
import type { Env, Variables } from "../types.js";

// biome-ignore lint/style/useNamingConvention: Hono generic parameter names
export const iconsRoutes = new Hono<{ Bindings: Env; Variables: Variables }>();

const ICON_HASH_PATTERN = /^[a-f0-9]{12}$/;

/** Maximum number of icons per request */
const MAX_ICONS_PER_REQUEST = 500;

/** Maximum size per icon (150KB base64 ~ 112KB binary) */
const MAX_ICON_BASE64_SIZE = 150_000;

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

/**
 * Decode base64 string to Uint8Array
 */
function base64ToUint8Array(base64: string): Uint8Array {
  const binaryString = atob(base64);
  const bytes = new Uint8Array(binaryString.length);
  for (let i = 0; i < binaryString.length; i++) {
    bytes[i] = binaryString.charCodeAt(i);
  }
  return bytes;
}

/**
 * POST /ingest/{token}/icons — receive app icons from CLI
 */
iconsRoutes.post("/:token/icons", async (c) => {
  const token = c.req.param("token");

  // 1. Validate webhook token
  const webhook = await validateWebhookToken<WebhookRow>(c.env.DB, token);

  if (!webhook) {
    return c.json({ error: "Invalid webhook token" }, 401);
  }

  if (webhook.is_active !== 1) {
    return c.json({ error: "Webhook is disabled" }, 403);
  }

  // 2. Parse and validate body
  let body: IconsRequestBody;
  try {
    const parsed: unknown = await c.req.json();
    if (!isValidBody(parsed)) {
      return c.json({ error: "Invalid request body" }, 400);
    }
    body = parsed;
  } catch {
    return c.json({ error: "Invalid JSON body" }, 400);
  }

  if (body.icons.length === 0) {
    return c.json({ stored: 0 }, 200);
  }

  if (body.icons.length > MAX_ICONS_PER_REQUEST) {
    return c.json({ error: `Too many icons (max ${MAX_ICONS_PER_REQUEST})` }, 400);
  }

  // 3. Validate individual icon sizes
  for (const icon of body.icons) {
    if (icon.data.length > MAX_ICON_BASE64_SIZE) {
      return c.json({ error: `Icon ${icon.hash} exceeds size limit` }, 400);
    }
  }

  // 4. Store icons in R2 (independent uploads, run in parallel)
  const errors: string[] = [];
  const prefix = c.env.ICON_PREFIX;

  const results = await Promise.all(
    body.icons.map(async (icon) => {
      try {
        const buffer = base64ToUint8Array(icon.data);
        await putIcon(c.env.ICONS, iconKey(icon.hash, prefix), buffer);
        return true;
      } catch (error) {
        console.error(`[icons] Failed to store icon ${icon.hash}:`, error);
        errors.push(icon.hash);
        return false;
      }
    }),
  );

  const stored = results.filter(Boolean).length;

  return c.json(
    {
      stored,
      ...(errors.length > 0 ? { errors } : {}),
    },
    errors.length > 0 ? 207 : 200,
  );
});
