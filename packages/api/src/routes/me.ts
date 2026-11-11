// /api/me — return the authenticated user's email/name/avatar.
// Reads `accessEmail` populated by accessAuth (CF Access JWT) or apiKeyAuth
// (Bearer token). Falls back to decoding `Cf-Access-Jwt-Assertion` directly
// so the route still works if no JWT-verifying middleware ran (e.g.
// dev/local with explicit headers). Public name + avatar come from lizheng.blog.
import { Hono } from "hono";
import type { AppEnv } from "../lib/app-env";
import { fetchAuthorProfile } from "../lib/public-avatar";

export interface AccessJwtPayload {
  email?: string;
  name?: string;
}

const DASH_RE = /-/g;
const UNDERSCORE_RE = /_/g;

export function decodeJwtPayload(jwt: string): AccessJwtPayload | null {
  const parts = jwt.split(".");
  if (parts.length !== 3 || !parts[1]) return null;
  try {
    const payload = atob(parts[1].replace(DASH_RE, "+").replace(UNDERSCORE_RE, "/"));
    return JSON.parse(payload) as AccessJwtPayload;
  } catch {
    return null;
  }
}

function resolveDisplayName(
  profileName: string | null,
  jwtName: string | undefined,
  email: string | null,
): string | null {
  if (profileName) return profileName;
  if (jwtName) return jwtName;
  if (email) return email.split("@")[0] ?? null;
  return null;
}

const app = new Hono<AppEnv>();

app.get("/", async (c) => {
  const ctxEmail = c.get("accessEmail");
  const jwt = c.req.header("Cf-Access-Jwt-Assertion");
  const jwtPayload = jwt ? decodeJwtPayload(jwt) : null;

  if (ctxEmail) {
    const profile = await fetchAuthorProfile(ctxEmail);
    return c.json({
      email: ctxEmail,
      name: resolveDisplayName(profile.name, jwtPayload?.name, ctxEmail),
      avatar: profile.avatar,
      authenticated: true,
    });
  }

  if (!jwt) {
    return c.json({ email: null, name: null, avatar: null, authenticated: false });
  }

  if (!jwtPayload) {
    return c.json({ email: null, name: null, avatar: null, authenticated: false });
  }

  const email = jwtPayload.email ?? null;
  const profile = email ? await fetchAuthorProfile(email) : { name: null, avatar: null };

  return c.json({
    email,
    name: resolveDisplayName(profile.name, jwtPayload.name, email),
    avatar: profile.avatar,
    authenticated: true,
  });
});

export default app;
