// is-localhost — trust-aware host check for dev/local bypass.
//
// Host headers are attacker-controlled, so we can't trust them in isolation.
// On Cloudflare Workers, `c.req.raw.cf` is populated by the CF edge AND by
// miniflare's local runtime. The discriminator we actually trust is the Host
// header binding: a real CF deployment is never bound to `localhost` /
// `127.0.0.1`, so a Host of those values means we are running locally
// (`wrangler dev --local`, vitest, embedded Next.js call) regardless of `cf`.
//
// Rules:
//   1. Host is `localhost` / `127.0.0.1` → local (always trust).
//   2. Otherwise on CF edge (`cf` present) → not local.
//   3. No `cf`, non-local Host → not local.
import type { Context } from "hono";

export function isLocalhost(c: Context): boolean {
  const host = c.req.header("host") ?? "";
  if (host.startsWith("localhost") || host.startsWith("127.0.0.1")) return true;
  return false;
}
