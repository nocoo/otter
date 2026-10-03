import type { Context, Next } from "hono";
import { createRemoteJWKSet, jwtVerify } from "jose";
import type { AppBindings, AppEnv } from "../lib/app-env";

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

const PUBLIC_PATHS = ["/api/live", "/v1/live"];

export async function accessAuth(c: Context<AppEnv>, next: Next) {
  if (PUBLIC_PATHS.includes(c.req.path)) return next();
  const env = (c.env ?? {}) as AppBindings;
  const jwt = c.req.header("Cf-Access-Jwt-Assertion");
  if (!jwt && hasBearer(c)) return next();
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
  if (!jwt) return c.json({ error: "Missing Access JWT" }, 401);
  try {
    const { payload } = await jwtVerify(jwt, getJwks(teamDomain), {
      issuer: `https://${teamDomain}`,
      audience: aud,
    });
    c.set("accessAuthenticated", true);
    const email = (payload as { email?: unknown }).email;
    if (typeof email === "string") c.set("accessEmail", email);
  } catch {
    return c.json({ error: "Invalid Access JWT" }, 403);
  }
  return next();
}
