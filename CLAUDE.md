README.md

## npm Publish Procedure

CLI package `@nocoo/otter` is published to npm. Steps to release a new version:

1. **Bump version** — Update `version` in ALL `package.json` files (root, core, cli, web, api), plus:
   - `packages/cli/src/cli.ts` (`meta.version`)
   - `packages/api/src/lib/version.ts` (fallback)
   - `packages/api/src/__tests__/unit/live-route.test.ts` (mock + assertion)
2. **Build** — `bun install && bun run build`
3. **Test** — `bun run test` (444+ tests must pass)
4. **Dry-run** — `npm publish --dry-run` in `packages/cli/`
5. **Publish** — `npm publish` in `packages/cli/` (requires `npm login` as `nocoo`)
6. **Verify** — `npx @nocoo/otter@latest --help` in a temp directory
7. **Commit & push** — Triggers Railway auto-deploy for web
8. **Tag & release** — `git tag vX.Y.Z && git push origin vX.Y.Z`, then `gh release create vX.Y.Z`

### Key decisions

- **Package name**: `@nocoo/otter` (personal scope, `otter-cli` was taken, `@otter` scope not owned)
- **`@otter/core` is NOT published**: It's pure TypeScript types (`export {}`), all CLI imports are `import type` — erased at compile time. Moved to `devDependencies` so npm doesn't try to resolve it.
- **npm publish is user-initiated only**: Never auto-publish. Only publish when the user explicitly requests it.

## Retrospective

- **`packages/api` is a pure logic library, not a standalone server**: It exports `createApp()` (Hono app factory) plus middleware/lib utilities. The web package embeds it via `app/api/[...slug]/route.ts` which rewrites `/api/*` to `/v1/*` and calls `app.fetch()` in-process. Single container, single Node process. Future Vite + cf worker migration just feeds the same `createApp()` to a worker entry — the api source stays put.
- **Auth.js chunks session cookies > 4KB into `.0/.1/...` suffixed cookies**: The auth middleware must scan all cookies starting with the base name, sort by numeric suffix, and concatenate before calling `decode()`. Reading only the bare cookie name returns 401 for any large session (e.g. with extra OAuth claims).
- **Next.js Turbopack does NOT accept `./foo.js` for a `./foo.ts` file**: Unlike `tsc`/Node ESM resolution, Turbopack uses webpack-style resolution. Strip `.js` extensions from intra-package imports when the package is consumed by Next.js.
- **Railway + Next.js standalone containers require `HOSTNAME=0.0.0.0`**: Next.js standalone server defaults to binding `localhost`, which is inaccessible from Railway's reverse proxy. Must set `HOSTNAME=0.0.0.0` env var so it listens on all interfaces.
- **Next.js 16 Turbopack monorepo builds require `turbopack.root`**: In Docker builds where the workspace root differs from the Next.js project dir, Turbopack cannot infer the root. Must set `turbopack: { root: path.join(__dirname, "../..") }` in `next.config.ts`.
- **Railway `dockerfilePath` format**: Use `./Dockerfile` (with `./` prefix), not bare `Dockerfile`.
- **Node.js fetch + dev TLS certs**: Dev subdomains (e.g. `otter.dev.hexly.ai`) may have incomplete certificate chains. `curl` tolerates this but Node.js `fetch` throws `UNABLE_TO_VERIFY_LEAF_SIGNATURE`. Workaround: `NODE_TLS_REJECT_UNAUTHORIZED=0 otter backup`. Production certs are fine — this only affects local testing against dev environments.
- **TypeScript project references + `--noEmit` breaks downstream type-checking**: When `@otter/core` has `composite: true` and CLI uses `references: [{ "path": "../core" }]`, running `tsc --noEmit -p packages/core` does NOT emit `.d.ts` files. The subsequent `tsc --noEmit -p packages/cli` reads stale `.d.ts` from `core/dist/` and misses new types. Fix: build core with emit first (`tsc -p packages/core`), then `--noEmit` for downstream packages.
- **Biome v2 `files` key is `includes` not `include`**: Biome v2.4+ renamed the key. Also `ignore` was removed — use `.gitignore` via `vcs.useIgnoreFile: true` instead.
- **Biome v2 domains only accept `"all"`, `"none"`, `"recommended"`**: Not `"off"`. Use `"none"` to disable a domain (e.g. `"solid": "none"`).
- **Biome `warn` rules don't fail `biome check`**: Only `error`-level rules cause exit code 1. Use `warn` for advisory rules.
- **`biome-ignore` in JSX must be on the line directly above the error**: For `noArrayIndexKey`, the error is on the `key=` prop, not the opening tag. Prefer content-based keys over `biome-ignore`.
- **`bun update <pkg> --filter` still adds to root package.json**: When updating workspace package deps, edit the specific `package.json` directly and run `bun install`, don't use `bun update --filter`.
- **Transitive dep vulnerabilities via `overrides`**: Use `"overrides"` in root `package.json` to pin transitive deps to patched versions (e.g. `"fast-xml-parser": ">=5.5.7"`).
- **next-auth JWT cookie name differs by env**: v5 uses `__Secure-authjs.session-token` in prod (HTTPS) and `authjs.session-token` in dev. A sibling service decoding the cookie via `@auth/core/jwt.decode` must replicate web's `useSecureCookies` logic exactly — the cookie name is also the `salt` argument, so a mismatch fails silently. Both services must share the same `AUTH_SECRET`.
- **`@auth/core` version must match next-auth's bundled version**: next-auth v5 pins a specific `@auth/core` (e.g. `0.41.0`). Using a different version in a sibling package can break JWT decode because salt/encryption defaults shift between versions. Pin the api package to whatever next-auth resolves.
- **Next.js stale `.next/**/validator.ts` after deleting routes**: Next.js caches a generated route validator; deleting `app/api/foo/route.ts` without clearing `.next*` leaves dangling references that fail `tsc`. Fix: `rm -rf packages/web/.next*` after any app-router file deletion.
- **`packages/web` is now the Vite SPA; the Next.js app moved to `packages/web_legacy`**: New stack is Vite 6 + React 19 + react-router 7 + SWR + Tailwind v4. The legacy Next.js app is frozen for rollback during the migration window — both build, but `bun run dev` points at the new SPA. Hit the legacy app with `bun run dev:legacy` if you need to compare behavior.
- **Single Cloudflare Worker hosts both `/api/*` and SPA assets**: `packages/worker` mounts the new D1-binding routes at `/api/*` (CF Access JWT + Bearer token), keeps the legacy `/v1/*` + `/health` + `/ingest/*` for `web_legacy` compatibility, and serves SPA fallback via `[assets] directory = "../web/dist"` with `not_found_handling = "single-page-application"` and `run_worker_first = ["/api/*", "/v1/*", "/health", "/ingest/*"]`. Build chain: `bun run build:web` → wrangler picks up the dist.
- **CF Access JWT verification falls through, never 401s on its own**: `accessAuth` middleware only sets `accessEmail` on success — missing/invalid tokens fall through so `apiKeyAuth` (Bearer) gets a chance. The actual 401 happens inside the route via `requireUser(c)`. This dual-stack pattern lets browsers and CLI share the same handler. Localhost requests without a Bearer header are auto-stamped as `dev@localhost` so `wrangler dev --local` works without faking JWTs.
- **Worker D1-binding tests must mock the driver, not rely on miniflare migrations**: The pre-existing legacy tests in `packages/worker/src/__tests__/{snapshots,webhooks}.test.ts` need raw `env.DB.exec("CREATE TABLE …")` in `beforeAll` to seed schema and currently fail for tables they forgot to create. New `/api/*` tests skip that entirely by passing an in-memory `DbDriver` to the route factory and a fake `R2Bucket`. Strongly prefer this pattern for any new route logic.

## Quality Gates (S-tier)

| Dim | Gate | Hook |
|-----|------|------|
| G1 | Biome strict check (lint + format, 0 errors) + lint-staged | pre-commit |
| L1 | 445+ vitest tests, 90%/89% coverage thresholds | pre-commit |
| tsc | TypeScript strict type check + 5 extras (core → cli → web → api) | pre-commit |
| G2 | osv-scanner (0 vulns) + gitleaks (0 leaks) | pre-push |
| L2 | 4 API E2E tests on real HTTP (web :17019 → api :17020) | pre-push |
| L3 | 6 Playwright specs / 28 tests (web :27019 → api :27020) | pre-push |
| D1 | `otter-db-test` D1 + `otter-snapshots-test` R2 (env override + guard + marker) | E2E runner |
