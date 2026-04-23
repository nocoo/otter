// is-localhost — trust-aware host check for dev/local bypass.
//
// Host headers are attacker-controlled, so we can't trust them in isolation.
// On Cloudflare Workers, `c.req.raw.cf` is populated by the CF edge — its
// presence proves the request traversed CF, where the Host reflects the
// real domain bound to the Worker (never `localhost`).
//
// Rules:
//   1. CF edge request (`cf` present): never localhost — reject spoofed Host.
//   2. No `cf` (local `wrangler dev`, vitest, embedded Next.js call):
//      allow `localhost` and `127.0.0.1`.
import type { Context } from "hono";

export function isLocalhost(c: Context): boolean {
  const host = c.req.header("host") ?? "";
  const onCfEdge = Boolean((c.req.raw as { cf?: unknown }).cf);
  if (onCfEdge) return false;
  return host.startsWith("localhost") || host.startsWith("127.0.0.1");
}
