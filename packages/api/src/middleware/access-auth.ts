// access-auth — Cloudflare Access JWT verification (fail-closed).
//
// Verifies `Cf-Access-Jwt-Assertion` against CF Access JWGS. On success,
// sets `accessAuthenticated`/`accessEmail` on the Hono context and falls
// through to the next middleware (typically apiKeyAuth, which sees the
// authenticated flag and passes through).
//
// Failure modes (after public-path / E2E-bypass / localhost short-circuits):
//   - env missing (CF_ACCESS_TEAM_DOMAIN / CF_ACCESS_AUD) → 500
//   - Cf-Access-Jwt-Assertion header missing               → 401
//   - JWT verification throws                              → 403
//
// Fail-CLOSED matters because the workers.dev subdomain is enabled and
// bypasses CF Access entirely — falling through here would let unauthenticated
// requests reach apiKeyAuth (and any other downstream that trusts upstream
// auth). See nocoo/otter#86 for the original report and the bat standard
// implementation this mirrors.
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
  if (!(teamDomain && aud)) {
    return c.json(
      {
        error: "Access authentication not configured. Set CF_ACCESS_TEAM_DOMAIN and CF_ACCESS_AUD.",
      },
      500,
    );
  }

  const jwt = c.req.header("Cf-Access-Jwt-Assertion");
  if (!jwt) {
    if (hasBearer(c)) return next();
    return c.json({ error: "Missing Access JWT" }, 401);
  }

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
    return c.json({ error: "Invalid Access JWT" }, 403);
  }
  return next();
}
