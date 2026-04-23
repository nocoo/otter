// access-auth — Cloudflare Access JWT verification.
//
// Verifies `Cf-Access-Jwt-Assertion` against CF Access JWKS. On success,
// sets `accessAuthenticated`/`accessEmail` on the Hono context. Falls
// through (does NOT 401) on missing/invalid token so apiKeyAuth can take a
// second chance with Bearer tokens.
import type { Context, Next } from "hono";
import { createRemoteJWKSet, jwtVerify } from "jose";
import type { AppEnv } from "../lib/app-env";
import { isLocalhost } from "./is-localhost";

let jwksCache: ReturnType<typeof createRemoteJWKSet> | null = null;
let jwksCacheTeamDomain: string | null = null;

function getJwks(teamDomain: string) {
  if (jwksCache && jwksCacheTeamDomain === teamDomain) return jwksCache;
  jwksCache = createRemoteJWKSet(new URL(`https://${teamDomain}/cdn-cgi/access/certs`));
  jwksCacheTeamDomain = teamDomain;
  return jwksCache;
}

export interface AccessAuthEnv {
  // biome-ignore lint/style/useNamingConvention: env var name
  CF_ACCESS_TEAM_DOMAIN?: string;
  // biome-ignore lint/style/useNamingConvention: env var name
  CF_ACCESS_AUD?: string;
}

const PUBLIC_PATHS = ["/api/live", "/v1/live"];

export async function accessAuth(c: Context<AppEnv>, next: Next) {
  if (PUBLIC_PATHS.includes(c.req.path)) return next();

  if (isLocalhost(c)) {
    const hasBearer = (c.req.header("Authorization") ?? "").startsWith("Bearer ");
    if (!hasBearer) {
      c.set("accessAuthenticated", true);
      c.set("accessEmail", "dev@localhost");
    }
    return next();
  }

  const env = (c.env ?? {}) as AccessAuthEnv;
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
