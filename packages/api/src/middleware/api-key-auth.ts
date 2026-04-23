// api-key-auth — Bearer token verification via api_tokens table.
//
// Pairs with accessAuth: if accessAuth already authenticated (CF Access JWT
// or localhost dev bypass), pass through. Otherwise look for a Bearer token
// and verify it against the hashed api_tokens.token_hash.
import type { Context, Next } from "hono";
import { touchApiTokenLastUsed, verifyApiToken } from "../lib/api-token-repo";
import type { AppEnv } from "../lib/app-env";
import type { DbDriver } from "../lib/db/driver";
import { isLocalhost } from "./is-localhost";

const PUBLIC_PATHS = ["/api/live", "/v1/live"];

function extractBearer(header: string | undefined): string | null {
  if (!header) return null;
  const parts = header.split(" ");
  if (parts.length !== 2 || parts[0] !== "Bearer") return null;
  return parts[1] ?? null;
}

export interface ApiKeyAuthOptions {
  getDriver: (c: Context<AppEnv>) => DbDriver;
}

export function createApiKeyAuth(opts: ApiKeyAuthOptions) {
  return async function apiKeyAuth(c: Context<AppEnv>, next: Next) {
    if (PUBLIC_PATHS.includes(c.req.path)) return next();

    const hasBearer = (c.req.header("Authorization") ?? "").startsWith("Bearer ");
    if (isLocalhost(c) && !hasBearer) return next();
    if (c.get("accessAuthenticated")) return next();

    const token = extractBearer(c.req.header("Authorization"));
    if (!token) return c.json({ error: "Unauthorized" }, 401);

    const driver = opts.getDriver(c);
    const result = await verifyApiToken(driver, token);
    if (!result) return c.json({ error: "Invalid API key" }, 403);

    c.set("accessAuthenticated", true);
    c.set("accessEmail", result.email);
    touchApiTokenLastUsed(driver, result.id).catch(() => {
      // best-effort; ignore failures
    });
    return next();
  };
}
