export interface MeLike {
  name?: string | null;
  email?: string | null;
  avatar?: string | null;
}

export function getDisplayName(user: MeLike | null | undefined): {
  name: string;
  initial: string;
  email: string | null;
  avatar: string | null;
} {
  const email = user?.email ?? null;
  const rawName = user?.name;
  const name = rawName && rawName.length > 0 ? rawName : (email?.split("@")[0] ?? "User");
  const initial = (name.charAt(0) || "U").toUpperCase();
  const avatar = user?.avatar && user.avatar.length > 0 ? user.avatar : null;
  return { name, initial, email, avatar };
}
