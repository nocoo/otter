import { auth } from "@/auth";

export interface AuthUser {
  id: string;
  email: string;
  name: string | null;
  image: string | null;
}

// E2E test bypass: return a deterministic fake user so API routes work
// without a real NextAuth session.
const E2E_USER: AuthUser | null =
  process.env.E2E_SKIP_AUTH === "true"
    ? {
        id: "e2e-test-user",
        email: "e2e@test.local",
        name: "E2E Test User",
        image: null,
      }
    : null;

// Ensures the E2E test user exists in D1 (lazy, runs once).
let e2eUserSeeded = false;
async function seedE2eUser(): Promise<void> {
  if (e2eUserSeeded || !E2E_USER) return;
  e2eUserSeeded = true;
  try {
    const { execute } = await import("@/lib/cf/d1");
    const now = Date.now();
    await execute(
      `INSERT INTO users (id, email, name, image, created_at, updated_at)
       VALUES (?1, ?2, ?3, ?4, ?5, ?6)
       ON CONFLICT (id) DO UPDATE SET updated_at = excluded.updated_at`,
      [E2E_USER.id, E2E_USER.email, E2E_USER.name, E2E_USER.image, now, now],
    );
  } catch (error) {
    console.error("[session] Failed to seed E2E user:", error);
  }
}

/**
 * Get the authenticated user from the current session.
 * Returns null if not authenticated or if user ID is missing.
 * Use this in API route handlers to get the current user.
 *
 * When E2E_SKIP_AUTH=true, returns a deterministic fake user so
 * L3 API E2E tests can exercise routes without Google OAuth.
 * On first call, seeds the E2E user into D1 to satisfy FK constraints.
 */
export async function getAuthUser(): Promise<AuthUser | null> {
  if (E2E_USER) {
    await seedE2eUser();
    return E2E_USER;
  }

  const session = await auth();
  if (!session?.user?.id || !session.user.email) {
    return null;
  }
  return {
    id: session.user.id,
    email: session.user.email,
    name: session.user.name ?? null,
    image: session.user.image ?? null,
  };
}
