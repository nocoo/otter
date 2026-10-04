# Retrospective

## 2026-10-04: Verify Basalt APIs and actual response shapes

The full migration initially assumed that Basalt's Dialog max-width enlarged its
fixed default width, that Dialog added a close button, and that SidebarItem could
replace links without losing browser navigation. Independent review found those
regressions. Read declarations and runtime source: use Dialog size, explicit
DialogClose controls and Button-asChild Router Links. Never invent token names;
Basalt has heatmap green tokens, not `--basalt-success`.

Real-storage screenshots exposed pre-existing Settings mock drift: production
webhook responses use snake_case, while UI fixtures used camelCase. A frontend
mapping now preserves timestamps and activation state; a real local browser CRUD
regression replaces that false confidence. Check real JSON before rebuilding views.
The public avatar API has no CORS header, so lookup belongs in the authenticated
same-origin Worker and uses only the verified email hash; no browser endpoint proxy.

## 2026-10-04: New environment controls must use Basalt

The first environment control reused Otter's copied Radix Tabs and browser-native
confirmation. The owner corrected the design requirement. This surface now uses
published Basalt SegmentControl, ConfirmDialog, ThemeProvider and ThemeToggle with
the documented Tailwind contract. Check the Basalt skill before adding controls;
existing copied templates are not evidence of current design compliance.

## 2026-10-04: Automated browser tests must never inherit a live proxy

The owner reported E2E machine records in Production. Source inspection confirmed
that the former BDD runner launched Vite, whose default `/api` proxy targeted the
production Worker. A localhost frontend URL did not establish local data isolation;
the report's exact production records were not inspected or deleted.

Both browser configurations now use the dedicated locked native-local E2E launcher,
refuse inherited production credentials and disable server reuse. Vite's production
proxy and authentication bypasses were removed. Each run owns fresh D1/R2 state and
an authenticated fixture identity, with marker/path/ownership checks before cleanup.
Regression checks cover the entrypoint, Prod lock and data isolation. Production
cleanup requires a separate record inventory and explicit deletion authorization.

During implementation, forwarding the gateway's `port: 0` into its Worker made
readiness poll port zero rather than Wrangler's allocated port. Runtime options now
pass only their own fields. Playwright's default process termination also left a
local child/state behind; both configs now use SIGTERM with bounded cleanup. The
owned leftovers were stopped and recovered only after dead-owner and D1-marker
verification. Keep gateway and Worker ports separate and verify cleanup at runtime.

Accident narratives belong here. Keep only recurring project rules in `AGENTS.md`; cross-project lessons belong in global rules and deterministic checks in hooks/tests.

Historical workarounds below record prior incidents; they do not authorize disabling TLS verification or contacting live services in automated tests.


- **`packages/api` is a pure logic library, not a standalone server**: It exports `createApp()` (Hono app factory) plus middleware/lib utilities. The Cloudflare Worker (`apps/api`) embeds it via `app.fetch()`. Single Worker, single deploy unit — `createApp()` stays runtime-agnostic.
- **Node.js fetch + dev TLS certs**: Dev subdomains (e.g. `otter.dev.hexly.ai`) may have incomplete certificate chains. `curl` tolerates this but Node.js `fetch` throws `UNABLE_TO_VERIFY_LEAF_SIGNATURE`. Workaround: `NODE_TLS_REJECT_UNAUTHORIZED=0 otter backup`. Production certs are fine — this only affects local testing against dev environments.
- **TypeScript project references + `--noEmit` breaks downstream type-checking**: When `@otter/core` has `composite: true` and CLI uses `references: [{ "path": "../../packages/core" }]`, running `tsc --noEmit -p packages/core` does NOT emit `.d.ts` files. The subsequent `tsc --noEmit -p apps/cli` reads stale `.d.ts` from `core/dist/` and misses new types. Fix: build core with emit first (`tsc -p packages/core`), then `--noEmit` for downstream packages.
- **Biome v2 `files` key is `includes` not `include`**: Biome v2.4+ renamed the key. Also `ignore` was removed — use `.gitignore` via `vcs.useIgnoreFile: true` instead.
- **Biome v2 domains only accept `"all"`, `"none"`, `"recommended"`**: Not `"off"`. Use `"none"` to disable a domain (e.g. `"solid": "none"`).
- **Biome `warn` rules don't fail `biome check`**: Only `error`-level rules cause exit code 1. Use `warn` for advisory rules.
- **`biome-ignore` in JSX must be on the line directly above the error**: For `noArrayIndexKey`, the error is on the `key=` prop, not the opening tag. Prefer content-based keys over `biome-ignore`.
- **`bun update <pkg> --filter` still adds to root package.json**: When updating workspace package deps, edit the specific `package.json` directly and run `bun install`, don't use `bun update --filter`.
- **Transitive dep vulnerabilities via `overrides`**: Use `"overrides"` in root `package.json` to pin transitive deps to patched versions (e.g. `"fast-xml-parser": ">=5.5.7"`).
- **`apps/web` is a Vite SPA, full stop**: Vite 7 + React 19 + react-router 7 + SWR + Tailwind v4. `bun run dev` runs the SPA dev server on :7019; `bun run dev:worker` runs the cf worker on :7020 in a second terminal. Build pipeline: `bun run build` (root) → `vite build` → `apps/web/dist/` → wrangler `[assets]` directory.
- **Single Cloudflare Worker hosts both `/api/*` and SPA assets**: `apps/api` mounts the D1-binding routes at `/api/*` (CF Access JWT + Bearer token), keeps `/health` + `/ingest/*` for CLI uploads, and serves SPA fallback via `[assets] directory = "../web/dist"` with `not_found_handling = "single-page-application"` and `run_worker_first = ["/api/*", "/health", "/ingest/*"]`. SPA uses `/api/*`, CLI uses `/ingest/*`.
- **CF Access JWT verification falls through, never 401s on its own**: `accessAuth` middleware only sets `accessEmail` on success — missing/invalid tokens fall through so `apiKeyAuth` (Bearer) gets a chance. The actual 401 happens inside the route via `requireUser(c)`. This dual-stack pattern lets browsers and CLI share the same handler. Localhost requests without a Bearer header are auto-stamped as `dev@localhost` so `wrangler dev --local` works without faking JWTs.
- **Worker D1-binding tests must mock the driver, not rely on miniflare migrations**: `/api/*` route tests pass an in-memory `DbDriver` to the route factory plus a fake `R2Bucket` and skip miniflare D1 entirely. Strongly prefer this pattern over `env.DB.exec("CREATE TABLE …")` in `beforeAll`, which rots silently when schemas drift.
- **Removing transitive deps can flip `@types/node` minor versions**: When upstream consumers go away, the workspace can fall back to a newer `@types/node` (e.g. `25.x` with `undici-types@7`), where `Response.json()` is correctly typed as `Promise<unknown>`. This surfaces as `TS18046` everywhere we did `const x: T = await res.json();`. Fix is to cast at the call site (`(await res.json()) as T`).
- **Surety mode (vite proxy → prod worker with Bearer injection)**: Local dev defaults to vite on `:7019` proxying `/api/*` to a real Cloudflare Worker (`https://otter.nocoo.workers.dev` by default, override via `OTTER_API_URL`). The proxy auto-injects `Authorization: Bearer <OTTER_DEV_API_TOKEN>` so requests bypass CF Access SSO and hit `apiKeyAuth` directly. Mint the token by opening `https://otter.hexly.ai/api/auth/cli?callback=http://127.0.0.1:65535/cb&state=mint` (302 redirect carries `?token=otk_...`). Vite `loadEnv` reads from `process.cwd()` which is `apps/web/` for the vite process — the `.env` file MUST live at `apps/web/.env`, not the repo root.
- **Vite 8 default host-check rejects custom local Host headers**: Caddy reverse-proxying `https://otter.dev.hexly.ai` → `localhost:7019` returns 403 from vite because the `Host` header isn't allowlisted. Fix: add `server.allowedHosts: ["otter.dev.hexly.ai", ".dev.hexly.ai"]` (leading dot = wildcard subdomains) to `vite.config.ts`.
- **Local DNS negative cache vs browser resolver after creating a Cloudflare custom domain**: After adding `routes = [{ pattern = "otter.hexly.ai", custom_domain = true }]` and redeploying, the local stub resolver may still cache "no answer" for several minutes while authoritative NS already returns IPs (verify with `dig +short otter.hexly.ai @<ns>.ns.cloudflare.com`). Browser uses its own DoH resolver and works immediately, but Node.js `fetch` (e.g. vite proxy) gets `getaddrinfo ENOTFOUND`. Workaround: point `OTTER_API_URL` to the `workers.dev` fallback (`https://otter.nocoo.workers.dev`) — Bearer auth works there too because `apiKeyAuth` doesn't require CF Access JWT.
- **Wrangler `routes` disables `workers_dev` unless explicitly re-enabled**: Adding `routes = [...]` to `wrangler.toml` for a custom domain silently drops the `*.workers.dev` URL. Must set `workers_dev = true` explicitly to keep both available — useful for surety mode (custom domain has CF Access SSO; workers.dev is Bearer-only fallback).
- **2026-10-01 — Do not search HOME or Library for Caddy**: The maintained config is `/opt/homebrew/etc/Caddyfile`. Otter is already `otter.dev.hexly.ai` → `localhost:7019`. Read that file or the coordinator-provided route. A broad home-directory scan is unnecessary.

### 2026-10-01: Inspect release lockfiles before automatic publication

The release script ran Bun 1.4.2 against a temporary mirror and committed mirror URLs in `bun.lock` before the coordinator inspected the generated diff. The published v3.0.1 tag stays immutable. A follow-up commit removes only registry URL fields, preserving every resolved version and integrity hash. Before invoking an automatic release, use the declared lockfile writer or separate preparation from publication and inspect the lockfile before commit and push.
