const PROFILE_ORIGIN = "https://lizheng.blog";
export const AUTHOR_PROFILE_URL = `${PROFILE_ORIGIN}/api/authors/profile`;
const FETCH_TIMEOUT_MS = 2500;

export interface AuthorProfile {
  name: string | null;
  avatar: string | null;
}

const EMPTY_PROFILE: AuthorProfile = { name: null, avatar: null };

export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

export async function hashEmail(email: string): Promise<string> {
  const bytes = new Uint8Array(
    await crypto.subtle.digest("SHA-256", new TextEncoder().encode(normalizeEmail(email))),
  );
  return Array.from(bytes, (value) => value.toString(16).padStart(2, "0")).join("");
}

interface AuthorProfileResponse {
  name?: unknown;
  avatar?: unknown;
}

export function parseAuthorProfile(data: unknown): AuthorProfile {
  if (!data || typeof data !== "object") {
    return EMPTY_PROFILE;
  }
  const rec = data as AuthorProfileResponse;
  const name = typeof rec.name === "string" && rec.name.length > 0 ? rec.name : null;
  const avatar = typeof rec.avatar === "string" && rec.avatar.length > 0 ? rec.avatar : null;
  return { name, avatar };
}

function sanitizeAvatarUrl(avatar: string | null): string | null {
  if (!avatar) return null;
  try {
    const url = new URL(avatar);
    return url.protocol === "https:" && !url.username && !url.password ? url.href : null;
  } catch {
    return null;
  }
}

function skipPublicLookup(email: string): boolean {
  const normalized = normalizeEmail(email);
  return !normalized || normalized.endsWith(".test") || !normalized.includes("@");
}

export async function fetchAuthorProfile(email: string): Promise<AuthorProfile> {
  if (skipPublicLookup(email)) {
    return EMPTY_PROFILE;
  }
  const hash = await hashEmail(email);
  try {
    const response = await fetch(`${AUTHOR_PROFILE_URL}?hash=${hash}`, {
      redirect: "manual",
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
    if (!response.ok) return EMPTY_PROFILE;
    const raw = parseAuthorProfile(await response.json());
    return {
      name: raw.name,
      avatar: sanitizeAvatarUrl(raw.avatar),
    };
  } catch {
    return EMPTY_PROFILE;
  }
}

export async function publicAvatar(email: string): Promise<string | null> {
  return (await fetchAuthorProfile(email)).avatar;
}
