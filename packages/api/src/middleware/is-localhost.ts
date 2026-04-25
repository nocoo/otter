// is-localhost — trust-aware host check for dev/local bypass.
//
// Host headers are attacker-controlled, so we can't trust them in isolation.
// On Cloudflare Workers, `c.req.raw.cf` is populated by the CF edge AND by
// miniflare's local runtime. The discriminator we actually trust is the Host
// header binding: a real CF deployment is never bound to `localhost` /
// `127.0.0.1`, so a Host of those values means we are running locally
// (`wrangler dev --local`, vitest, embedded Next.js call) regardless of `cf`.
//
// Test env (`ENVIRONMENT === "test"`) is also treated as local: it binds the
// isolated otter-db-test D1 + otter-snapshots-test R2 (verified via
// _test_marker before any test runs), so granting dev@localhost stamping is
// the only way L2 E2E hitting `wrangler dev --remote` can exercise auth-gated
// routes without minting per-request CF Access JWTs.
//
// Rules:
//   1. Host is `localhost` / `127.0.0.1` → local (always trust).
//   2. ENVIRONMENT === "test" → local (test D1 is isolated by _test_marker).
//   3. Otherwise on CF edge (`cf` present) → not local.
//   4. No `cf`, non-local Host → not local.
import type { Context } from "hono";

export function isLocalhost(c: Context): boolean {
  const host = c.req.header("host") ?? "";
  if (host.startsWith("localhost") || host.startsWith("127.0.0.1")) return true;
  // biome-ignore lint/style/useNamingConvention: env var name from wrangler.toml
  const env = (c.env ?? {}) as { ENVIRONMENT?: string };
  if (env.ENVIRONMENT === "test") return true;
  return false;
}
