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
