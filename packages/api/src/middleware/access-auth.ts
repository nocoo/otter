// access-auth — Cloudflare Access JWT verification.
//
// Verifies `Cf-Access-Jwt-Assertion` against CF Access JWKS. On success,
// sets `accessAuthenticated`/`accessEmail` on the Hono context. Falls
// through (does NOT 401) on missing/invalid token so apiKeyAuth can take a
// second chance with Bearer tokens.
import type { Context, Next } from "hono";
import { createRemoteJWKSet, jwtVerify } from "jose";
import type { AppBindings, AppEnv } from "../lib/app-env";
import { isLocalhost } from "./is-localhost";

let jwksCache: ReturnType<typeof createRemoteJWKSet> | null = null;
let jwksCacheTeamDomain: string | null = null;

function getJwks(teamDomain: string) {
  if (jwksCache && jwksCacheTeamDomain === teamDomain) return jwksCache;
  jwksCache = createRemoteJWKSet(new URL(`https://${teamDomain}/cdn-cgi/access/certs`));
  jwksCacheTeamDomain = teamDomain;
  return jwksCache;
}

function hasBearer(c: Context<AppEnv>): boolean {
  return (c.req.header("Authorization") ?? "").startsWith("Bearer ");
}

/**
 * E2E bypass: explicit flag + non-production guard (pika pattern).
 * wrangler dev --local may rewrite the Host header, making isLocalhost()
 * unreliable. Returns true if the request was handled (caller should return).
 */
function tryE2eBypass(c: Context<AppEnv>, env: AppBindings): boolean {
  if (env.E2E_SKIP_AUTH !== "true" || env.ENVIRONMENT === "production") return false;
  if (!hasBearer(c)) {
    c.set("accessAuthenticated", true);
    c.set("accessEmail", env.DEV_USER_EMAIL ?? "dev@localhost");
  }
  return true;
}

const PUBLIC_PATHS = ["/api/live", "/v1/live"];

export async function accessAuth(c: Context<AppEnv>, next: Next) {
  if (PUBLIC_PATHS.includes(c.req.path)) return next();

  const env = (c.env ?? {}) as AppBindings;

  if (tryE2eBypass(c, env)) return next();

  if (isLocalhost(c)) {
    if (!hasBearer(c)) {
      c.set("accessAuthenticated", true);
      c.set("accessEmail", "dev@localhost");
    }
    return next();
  }

  const teamDomain = env.CF_ACCESS_TEAM_DOMAIN;
  const aud = env.CF_ACCESS_AUD;
  if (!(teamDomain && aud)) return next();

  const jwt = c.req.header("Cf-Access-Jwt-Assertion");
  if (!jwt) return next();

  try {
    const jwks = getJwks(teamDomain);
    const { payload } = await jwtVerify(jwt, jwks, {
      issuer: `https://${teamDomain}`,
      audience: aud,
    });
    c.set("accessAuthenticated", true);
    const email = (payload as { email?: unknown }).email;
    if (typeof email === "string") {
      c.set("accessEmail", email);
    }
  } catch {
    // verification failed — let apiKeyAuth try
  }
  return next();
}
