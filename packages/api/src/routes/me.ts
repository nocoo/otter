// /api/me — return the authenticated user's email/name.
// Reads `accessEmail` populated by accessAuth (CF Access JWT) or apiKeyAuth
// (Bearer token). Falls back to decoding `Cf-Access-Jwt-Assertion` directly
// so the route still works if no JWT-verifying middleware ran (e.g.
// dev/local with explicit headers).
import { Hono } from "hono";
import type { AppEnv } from "../lib/app-env";

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

const app = new Hono<AppEnv>();

app.get("/", (c) => {
  const ctxEmail = c.get("accessEmail");
  if (ctxEmail) {
    return c.json({
      email: ctxEmail,
      name: ctxEmail.split("@")[0] ?? null,
      authenticated: true,
    });
  }
  const jwt = c.req.header("Cf-Access-Jwt-Assertion");
  if (!jwt) return c.json({ email: null, name: null, authenticated: false });
  const payload = decodeJwtPayload(jwt);
  if (!payload) return c.json({ email: null, name: null, authenticated: false });
  return c.json({
    email: payload.email ?? null,
    name: payload.name ?? payload.email?.split("@")[0] ?? null,
    authenticated: true,
  });
});

export default app;
