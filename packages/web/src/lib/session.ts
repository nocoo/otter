import { auth } from "@/auth";

export interface AuthUser {
  id: string;
  email: string;
  name: string | null;
  image: string | null;
}

/**
 * Get the authenticated user from the current session.
 * Returns null if not authenticated or if user ID is missing.
 * Use this in API route handlers to get the current user.
 */
export async function getAuthUser(): Promise<AuthUser | null> {
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
