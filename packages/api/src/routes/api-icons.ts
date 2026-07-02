// /api/icons — Bearer-authenticated icon uploads for the CLI backup flow.
//
// Body: { icons: [{ hash: 12-hex, data: base64-png }, ...] }.
// The same validation limits used by the legacy /ingest/:token/icons apply.

import { type Context, Hono } from "hono";
import type { AppEnv } from "../lib/app-env";
import { DEFAULT_ICON_PREFIX, iconKey, putIcon } from "../lib/icon-store";
import type { R2BucketLike } from "../lib/r2";

const ICON_HASH_PATTERN = /^[a-f0-9]{12}$/;
const MAX_ICONS_PER_REQUEST = 500;
/** 150KB base64 ~ 112KB binary */
const MAX_ICON_BASE64_SIZE = 150_000;

interface IconPayload {
  hash: string;
  data: string;
}

interface IconsRequestBody {
  icons: IconPayload[];
}

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

function base64ToUint8Array(base64: string): Uint8Array {
  const binaryString = atob(base64);
  const bytes = new Uint8Array(binaryString.length);
  for (let i = 0; i < binaryString.length; i++) {
    bytes[i] = binaryString.charCodeAt(i);
  }
  return bytes;
}

function requireUser(c: Context<AppEnv>): { email: string } | Response {
  const email = c.get("accessEmail");
  if (!email) return c.json({ error: "Unauthorized" }, 401);
  return { email };
}

export interface IconsRouteOptions {
  getBucket: (c: Context<AppEnv>) => R2BucketLike;
  getPrefix?: (c: Context<AppEnv>) => string;
}

interface ParsedIconsBody {
  ok: true;
  icons: IconPayload[];
}

interface RejectedIconsBody {
  ok: false;
  status: 400;
  error: string;
}

async function parseAndValidateBody(
  c: Context<AppEnv>,
): Promise<ParsedIconsBody | RejectedIconsBody> {
  let body: IconsRequestBody;
  try {
    const parsed: unknown = await c.req.json();
    if (!isValidBody(parsed)) return { ok: false, status: 400, error: "Invalid request body" };
    body = parsed;
  } catch {
    return { ok: false, status: 400, error: "Invalid JSON body" };
  }

  if (body.icons.length > MAX_ICONS_PER_REQUEST) {
    return { ok: false, status: 400, error: `Too many icons (max ${MAX_ICONS_PER_REQUEST})` };
  }

  for (const icon of body.icons) {
    if (icon.data.length > MAX_ICON_BASE64_SIZE) {
      return { ok: false, status: 400, error: `Icon ${icon.hash} exceeds size limit` };
    }
  }

  return { ok: true, icons: body.icons };
}

export function createApiIconsRoute(opts: IconsRouteOptions) {
  const app = new Hono<AppEnv>();

  app.post("/", async (c) => {
    const auth = requireUser(c);
    if (auth instanceof Response) return auth;

    const parsed = await parseAndValidateBody(c);
    if (!parsed.ok) return c.json({ error: parsed.error }, parsed.status);
    if (parsed.icons.length === 0) return c.json({ stored: 0 }, 200);

    const bucket = opts.getBucket(c);
    const prefix = opts.getPrefix?.(c) ?? DEFAULT_ICON_PREFIX;

    const errors: string[] = [];
    const results = await Promise.all(
      parsed.icons.map(async (icon) => {
        try {
          const buffer = base64ToUint8Array(icon.data);
          await putIcon(bucket, iconKey(icon.hash, prefix), buffer);
          return true;
        } catch (error) {
          console.error(`[api/icons] Failed to store icon ${icon.hash}:`, error);
          errors.push(icon.hash);
          return false;
        }
      }),
    );

    const stored = results.filter(Boolean).length;

    return c.json(
      { stored, ...(errors.length > 0 ? { errors } : {}) },
      errors.length > 0 ? 207 : 200,
    );
  });

  return app;
}
