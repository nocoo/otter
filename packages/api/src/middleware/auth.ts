import { decode } from "@auth/core/jwt";
import type { Context, MiddlewareHandler } from "hono";
import { getCookie } from "hono/cookie";
import { execute } from "../lib/cf/d1.js";

export interface AuthUser {
  id: string;
  email: string;
  name: string | null;
  image: string | null;
}

type Variables = { user: AuthUser };
// biome-ignore lint/style/useNamingConvention: Hono requires `Variables` key
export type AuthContext = Context<{ Variables: Variables }>;

const E2E_USER: AuthUser | null =
  process.env.E2E_SKIP_AUTH === "true"
    ? {
        id: "e2e-test-user",
        email: "e2e@test.local",
        name: "E2E Test User",
        image: null,
      }
    : null;

let e2eUserSeeded = false;
async function seedE2eUser(): Promise<void> {
  if (e2eUserSeeded || !E2E_USER) return;
  e2eUserSeeded = true;
  try {
    const now = Date.now();
    await execute(
      `INSERT INTO users (id, email, name, image, created_at, updated_at)
       VALUES (?1, ?2, ?3, ?4, ?5, ?6)
       ON CONFLICT (id) DO UPDATE SET updated_at = excluded.updated_at`,
      [E2E_USER.id, E2E_USER.email, E2E_USER.name, E2E_USER.image, now, now],
    );
  } catch (error) {
    console.error("[auth] Failed to seed E2E user:", error);
  }
}

function getCookieName(): string {
  const useSecureCookies =
    process.env.NODE_ENV === "production" ||
    process.env.NEXTAUTH_URL?.startsWith("https://") ||
    process.env.USE_SECURE_COOKIES === "true";
  return useSecureCookies ? "__Secure-authjs.session-token" : "authjs.session-token";
}

// biome-ignore lint/style/useNamingConvention: Hono requires `Variables` key
export const authMiddleware: MiddlewareHandler<{ Variables: Variables }> = async (c, next) => {
  if (E2E_USER) {
    await seedE2eUser();
    c.set("user", E2E_USER);
    await next();
    return;
  }

  const cookieName = getCookieName();
  const token = getCookie(c, cookieName);
  if (!token) {
    return c.json({ error: "Unauthorized" }, 401);
  }

  const secret = process.env.AUTH_SECRET;
  if (!secret) {
    console.error("[auth] AUTH_SECRET not set");
    return c.json({ error: "Server misconfigured" }, 500);
  }

  let payload: Record<string, unknown> | null;
  try {
    payload = (await decode({
      token,
      secret,
      salt: cookieName,
    })) as Record<string, unknown> | null;
  } catch (err) {
    console.error("[auth] JWT decode failed:", err);
    return c.json({ error: "Unauthorized" }, 401);
  }

  if (!payload) {
    return c.json({ error: "Unauthorized" }, 401);
  }

  const userId = (payload.userId as string | undefined) ?? (payload.sub as string | undefined);
  const email = payload.email as string | undefined;
  if (!userId || !email) {
    return c.json({ error: "Unauthorized" }, 401);
  }

  c.set("user", {
    id: userId,
    email,
    name: (payload.name as string | undefined) ?? null,
    image: (payload.picture as string | undefined) ?? null,
  });
  await next();
};

export function getUser(c: AuthContext): AuthUser {
  return c.get("user");
}
