// /api/auth/cli — mint a CLI Bearer token after CF Access auth.
//
// Unified pairing protocol (single source of truth):
//   1. CLI opens browser → `${host}/cli/connect?callback=<loopback>&state=<nonce>`
//   2. Web SPA at /cli/connect verifies the callback is loopback, then
//      window.location → `/api/auth/cli?callback=<loopback>&state=<nonce>`
//      so the CF Access cookie attaches.
//   3. This route mints a fresh api_token bound to `accessEmail` and 302s to
//      `${callback}?token=<jwt>&state=<nonce>&email=<addr>`.
//
// `callback` MUST be loopback http (CLI cannot serve HTTPS).
import { type Context, Hono } from "hono";
import { createApiToken } from "../lib/api-token-repo";
import type { AppEnv } from "../lib/app-env";
import type { DbDriver } from "../lib/db/driver";

export function isLocalhostUrl(value: string): boolean {
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    return false;
  }
  if (parsed.protocol !== "http:") return false;
  return parsed.hostname === "127.0.0.1" || parsed.hostname === "localhost";
}

export interface AuthCliRouteOptions {
  getDriver: (c: Context<AppEnv>) => DbDriver;
}

export function createAuthCliRoute(opts: AuthCliRouteOptions) {
  const app = new Hono<AppEnv>();

  app.get("/", async (c) => {
    const callback = c.req.query("callback");
    const state = c.req.query("state") ?? "";

    if (!callback) return c.json({ error: "callback is required" }, 400);
    if (!isLocalhostUrl(callback))
      return c.json({ error: "callback must be a loopback http URL" }, 400);

    const email = c.get("accessEmail");
    if (!email) return c.json({ error: "CF Access session required to mint a CLI token" }, 400);

    const driver = opts.getDriver(c);
    const { token } = await createApiToken(driver, { email });

    const redirect = new URL(callback);
    redirect.searchParams.set("token", token);
    if (state) redirect.searchParams.set("state", state);
    redirect.searchParams.set("email", email);
    return c.redirect(redirect.toString(), 302);
  });

  return app;
}
