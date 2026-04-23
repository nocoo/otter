// /api/auth/cli — mint a CLI Bearer token after CF Access auth.
//
// Flow: CLI redirects user to /api/auth/cli?callback_url=http://127.0.0.1:PORT/cb&state=NONCE.
// CF Access intercepts → user signs in → request lands here with verified
// `accessEmail` in context. We mint a fresh api_token bound to that email
// and 302 to callback_url with `api_key`/`state`/`email` query params.
//
// callback_url must be loopback http (CLI cannot serve HTTPS).
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
    const callbackUrl = c.req.query("callback_url") ?? c.req.query("callback");
    const state = c.req.query("state") ?? "";

    if (!callbackUrl) return c.json({ error: "callback_url is required" }, 400);
    if (!isLocalhostUrl(callbackUrl))
      return c.json({ error: "callback_url must be a localhost URL" }, 400);

    const email = c.get("accessEmail");
    if (!email) return c.json({ error: "CF Access session required to mint a CLI token" }, 400);

    const driver = opts.getDriver(c);
    const { token } = await createApiToken(driver, { email });

    const redirect = new URL(callbackUrl);
    redirect.searchParams.set("api_key", token);
    if (state) redirect.searchParams.set("state", state);
    redirect.searchParams.set("email", email);
    return c.redirect(redirect.toString(), 302);
  });

  return app;
}
