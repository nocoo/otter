// /api/webhooks — D1-binding-backed webhook routes for the Vite SPA.
//
// Authenticated via `accessEmail` populated by accessAuth (CF Access JWT) or
// apiKeyAuth (Bearer token). Pure D1 driver — no R2 needed.

import { type Context, Hono } from "hono";
import type { AppEnv } from "../lib/app-env";
import type { DbDriver } from "../lib/db/driver";
import {
  createWebhook,
  deleteWebhook,
  getWebhookByIdForUser,
  getWebhookOwnership,
  listWebhooks,
  type UpdateWebhookInput,
  updateWebhook,
} from "../lib/webhook-repo";

function requireUser(c: Context<AppEnv>): { email: string } | Response {
  const email = c.get("accessEmail");
  if (!email) return c.json({ error: "Unauthorized" }, 401);
  return { email };
}

const TOKEN_RE = /\+/g;
const SLASH_RE = /\//g;
const TRAILING_EQ_RE = /=+$/;

function generateWebhookToken(): string {
  const bytes = new Uint8Array(24);
  crypto.getRandomValues(bytes);
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(TOKEN_RE, "-").replace(SLASH_RE, "_").replace(TRAILING_EQ_RE, "");
}

export interface WebhooksRouteOptions {
  getDriver: (c: Context<AppEnv>) => DbDriver;
}

export function createApiWebhooksRoute(opts: WebhooksRouteOptions) {
  const app = new Hono<AppEnv>();

  app.get("/", async (c) => {
    const auth = requireUser(c);
    if (auth instanceof Response) return auth;
    const rows = await listWebhooks(opts.getDriver(c), auth.email);
    return c.json({ webhooks: rows });
  });

  app.post("/", async (c) => {
    const auth = requireUser(c);
    if (auth instanceof Response) return auth;
    const body = (await c.req.json().catch(() => ({}))) as { label?: string };
    const created = await createWebhook(opts.getDriver(c), {
      id: crypto.randomUUID(),
      userId: auth.email,
      token: generateWebhookToken(),
      label: body.label ?? "default",
      createdAt: Date.now(),
    });
    return c.json({ webhook: created });
  });

  app.get("/:id", async (c) => {
    const auth = requireUser(c);
    if (auth instanceof Response) return auth;
    const row = await getWebhookByIdForUser(opts.getDriver(c), auth.email, c.req.param("id"));
    if (!row) return c.json({ error: "Webhook not found" }, 404);
    return c.json({ webhook: row });
  });

  app.patch("/:id", async (c) => {
    const auth = requireUser(c);
    if (auth instanceof Response) return auth;
    const id = c.req.param("id");
    const driver = opts.getDriver(c);
    const owner = await getWebhookOwnership(driver, id);
    if (!owner || owner.user_id !== auth.email) return c.json({ error: "Webhook not found" }, 404);
    const body = (await c.req.json().catch(() => ({}))) as UpdateWebhookInput;
    const updated = await updateWebhook(driver, id, body);
    return c.json({ webhook: updated });
  });

  app.delete("/:id", async (c) => {
    const auth = requireUser(c);
    if (auth instanceof Response) return auth;
    const id = c.req.param("id");
    const driver = opts.getDriver(c);
    const owner = await getWebhookOwnership(driver, id);
    if (!owner || owner.user_id !== auth.email) return c.json({ error: "Webhook not found" }, 404);
    await deleteWebhook(driver, id);
    return c.json({ success: true });
  });

  return app;
}
