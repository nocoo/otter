README.md

## Release Procedure

CLI package `@nocoo/otter` is published to npm. Use the automated release script:

```bash
bun run release              # patch bump (default)
bun run release -- minor     # minor bump
bun run release -- major     # major bump
bun run release -- 2.1.0     # explicit version
bun run release -- --dry-run # preview without side effects
```

The script handles:
1. Version bump in 8 files (all package.json + cli.ts + version.ts)
2. CHANGELOG generation from conventional commits
3. Build verification
4. Commit + tag + push + GitHub release

After release completes:
- **Worker deploy**: CD auto-triggers on CI green
- **npm publish** (manual): `cd packages/cli && npm publish` (requires `npm login` as `nocoo`)
- **Verify**: `npx @nocoo/otter@latest --help` in a temp directory

### Key decisions

- **Package name**: `@nocoo/otter` (personal scope, `otter-cli` was taken, `@otter` scope not owned)
- **`@otter/core` is NOT published**: Pure TypeScript types, all imports are `import type` — erased at compile time
- **npm publish is user-initiated only**: Never auto-publish. Only publish when explicitly requested

## Retrospective

- **`packages/api` is a pure logic library, not a standalone server**: It exports `createApp()` (Hono app factory) plus middleware/lib utilities. The Cloudflare Worker (`packages/worker`) embeds it via `app.fetch()`. Single Worker, single deploy unit — `createApp()` stays runtime-agnostic.
- **Node.js fetch + dev TLS certs**: Dev subdomains (e.g. `otter.dev.hexly.ai`) may have incomplete certificate chains. `curl` tolerates this but Node.js `fetch` throws `UNABLE_TO_VERIFY_LEAF_SIGNATURE`. Workaround: `NODE_TLS_REJECT_UNAUTHORIZED=0 otter backup`. Production certs are fine — this only affects local testing against dev environments.
- **TypeScript project references + `--noEmit` breaks downstream type-checking**: When `@otter/core` has `composite: true` and CLI uses `references: [{ "path": "../core" }]`, running `tsc --noEmit -p packages/core` does NOT emit `.d.ts` files. The subsequent `tsc --noEmit -p packages/cli` reads stale `.d.ts` from `core/dist/` and misses new types. Fix: build core with emit first (`tsc -p packages/core`), then `--noEmit` for downstream packages.
- **Biome v2 `files` key is `includes` not `include`**: Biome v2.4+ renamed the key. Also `ignore` was removed — use `.gitignore` via `vcs.useIgnoreFile: true` instead.
- **Biome v2 domains only accept `"all"`, `"none"`, `"recommended"`**: Not `"off"`. Use `"none"` to disable a domain (e.g. `"solid": "none"`).
- **Biome `warn` rules don't fail `biome check`**: Only `error`-level rules cause exit code 1. Use `warn` for advisory rules.
- **`biome-ignore` in JSX must be on the line directly above the error**: For `noArrayIndexKey`, the error is on the `key=` prop, not the opening tag. Prefer content-based keys over `biome-ignore`.
- **`bun update <pkg> --filter` still adds to root package.json**: When updating workspace package deps, edit the specific `package.json` directly and run `bun install`, don't use `bun update --filter`.
- **Transitive dep vulnerabilities via `overrides`**: Use `"overrides"` in root `package.json` to pin transitive deps to patched versions (e.g. `"fast-xml-parser": ">=5.5.7"`).
- **`packages/web` is a Vite SPA, full stop**: Vite 7 + React 19 + react-router 7 + SWR + Tailwind v4. `bun run dev` runs the SPA dev server on :7019; `bun run dev:worker` runs the cf worker on :7020 in a second terminal. Build pipeline: `bun run build` (root) → `vite build` → `packages/web/dist/` → wrangler `[assets]` directory.
- **Single Cloudflare Worker hosts both `/api/*` and SPA assets**: `packages/worker` mounts the D1-binding routes at `/api/*` (CF Access JWT + Bearer token), keeps `/health` + `/ingest/*` for CLI uploads, and serves SPA fallback via `[assets] directory = "../web/dist"` with `not_found_handling = "single-page-application"` and `run_worker_first = ["/api/*", "/health", "/ingest/*"]`. SPA uses `/api/*`, CLI uses `/ingest/*`.
- **CF Access JWT verification falls through, never 401s on its own**: `accessAuth` middleware only sets `accessEmail` on success — missing/invalid tokens fall through so `apiKeyAuth` (Bearer) gets a chance. The actual 401 happens inside the route via `requireUser(c)`. This dual-stack pattern lets browsers and CLI share the same handler. Localhost requests without a Bearer header are auto-stamped as `dev@localhost` so `wrangler dev --local` works without faking JWTs.
- **Worker D1-binding tests must mock the driver, not rely on miniflare migrations**: `/api/*` route tests pass an in-memory `DbDriver` to the route factory plus a fake `R2Bucket` and skip miniflare D1 entirely. Strongly prefer this pattern over `env.DB.exec("CREATE TABLE …")` in `beforeAll`, which rots silently when schemas drift.
- **Removing transitive deps can flip `@types/node` minor versions**: When upstream consumers go away, the workspace can fall back to a newer `@types/node` (e.g. `25.x` with `undici-types@7`), where `Response.json()` is correctly typed as `Promise<unknown>`. This surfaces as `TS18046` everywhere we did `const x: T = await res.json();`. Fix is to cast at the call site (`(await res.json()) as T`).
- **Surety mode (vite proxy → prod worker with Bearer injection)**: Local dev defaults to vite on `:7019` proxying `/api/*` to a real Cloudflare Worker (`https://otter.nocoo.workers.dev` by default, override via `OTTER_API_URL`). The proxy auto-injects `Authorization: Bearer <OTTER_DEV_API_TOKEN>` so requests bypass CF Access SSO and hit `apiKeyAuth` directly. Mint the token by opening `https://otter.hexly.ai/api/auth/cli?callback=http://127.0.0.1:65535/cb&state=mint` (302 redirect carries `?token=otk_...`). Vite `loadEnv` reads from `process.cwd()` which is `packages/web/` for the vite process — the `.env` file MUST live at `packages/web/.env`, not the repo root.
- **Vite 8 default host-check rejects custom local Host headers**: Caddy reverse-proxying `https://otter.dev.hexly.ai` → `localhost:7019` returns 403 from vite because the `Host` header isn't allowlisted. Fix: add `server.allowedHosts: ["otter.dev.hexly.ai", ".dev.hexly.ai"]` (leading dot = wildcard subdomains) to `vite.config.ts`.
- **Local DNS negative cache vs browser resolver after creating a Cloudflare custom domain**: After adding `routes = [{ pattern = "otter.hexly.ai", custom_domain = true }]` and redeploying, the local stub resolver may still cache "no answer" for several minutes while authoritative NS already returns IPs (verify with `dig +short otter.hexly.ai @<ns>.ns.cloudflare.com`). Browser uses its own DoH resolver and works immediately, but Node.js `fetch` (e.g. vite proxy) gets `getaddrinfo ENOTFOUND`. Workaround: point `OTTER_API_URL` to the `workers.dev` fallback (`https://otter.nocoo.workers.dev`) — Bearer auth works there too because `apiKeyAuth` doesn't require CF Access JWT.
- **Wrangler `routes` disables `workers_dev` unless explicitly re-enabled**: Adding `routes = [...]` to `wrangler.toml` for a custom domain silently drops the `*.workers.dev` URL. Must set `workers_dev = true` explicitly to keep both available — useful for surety mode (custom domain has CF Access SSO; workers.dev is Bearer-only fallback).

## Quality Gates (S-tier)

| Dim | Gate | Hook |
|-----|------|------|
| G1 | Biome strict check (lint + format, 0 errors, 0 warnings) + lint-staged | pre-commit |
| L1 | 559+ vitest tests, 95%/94%/95%/95% (stmt/branch/func/line) coverage | pre-commit |
| tsc | TypeScript strict type check (core → cli → web → api) | pre-commit |
| L2 | Real-HTTP API + CLI E2E vs `wrangler dev --env test --remote` (otter-db-test). Boots on `:17020`, hard-fails on missing CF env. `OTTER_SKIP_L2=1` opts out (offline-only). | pre-push |
| G2 | osv-scanner (lockfile, 0 vulns) + gitleaks (full history, 0 leaks) | pre-push |
| CI  | `nocoo/base-ci/.github/workflows/bun-quality.yml@v2026.1` (L1+G1+tsc+G2) | GitHub Actions |
