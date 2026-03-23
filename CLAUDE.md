README.md

## npm Publish Procedure

CLI package `@nocoo/otter` is published to npm. Steps to release a new version:

1. **Bump version** — Update `version` in ALL `package.json` files (root, core, cli, web), plus:
   - `packages/cli/src/cli.ts` (`meta.version`)
   - `packages/web/src/lib/version.ts` (fallback)
   - `packages/web/src/__tests__/unit/live-route.test.ts` (mock + assertion)
2. **Build** — `bun install && bun run build`
3. **Test** — `bun run test` (291+ tests must pass)
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

## Quality Gates (S-tier)

| Dim | Gate | Hook |
|-----|------|------|
| G1 | Biome check (lint + format, 0 errors) + lint-staged | pre-commit |
| L1 | 436+ vitest tests, 90% coverage thresholds | pre-commit |
| tsc | TypeScript strict type check (core → cli → web) | pre-commit |
| G2 | osv-scanner (0 vulns) + gitleaks (0 leaks) | pre-push |
| L2 | 4 API E2E tests on real HTTP (:17029) | pre-push |
| L3 | Playwright browser E2E smoke spec (:27029) | pre-push |
| D1 | N/A (no storage) | — |
