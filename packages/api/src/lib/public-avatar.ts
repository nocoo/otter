const PROFILE_ORIGIN = "https://lizheng.blog";

export async function publicAvatar(email: string): Promise<string | null> {
  const normalized = email.trim().toLowerCase();
  if (!normalized || normalized.endsWith(".test") || !normalized.includes("@")) return null;
  const bytes = new Uint8Array(
    await crypto.subtle.digest("SHA-256", new TextEncoder().encode(normalized)),
  );
  const hash = Array.from(bytes, (value) => value.toString(16).padStart(2, "0")).join("");
  try {
    const response = await fetch(`${PROFILE_ORIGIN}/api/authors/profile?hash=${hash}`, {
      redirect: "error",
      signal: AbortSignal.timeout(5000),
    });
    if (!response.ok) return null;
    const profile = (await response.json()) as { avatar?: unknown };
    if (typeof profile.avatar !== "string") return null;
    const url = new URL(profile.avatar);
    return url.protocol === "https:" && !url.username && !url.password ? url.href : null;
  } catch {
    return null;
  }
}
