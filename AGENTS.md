# Otter

Configuration backup snapshots across a CLI (`apps/cli`, `@nocoo/otter`), Vite/React web workspace (`apps/web`, `@nocoo/basalt` ^3.5.1), Cloudflare Worker (`apps/api`), and native macOS Swift/AppKit app (`apps/macos`), backed by shared `packages/core` and `packages/api`.

Docs: [README.md](README.md) · [Architecture](docs/01-architecture.md) · [Backup design](docs/features/04-configuration-backup-redesign.md) · [Development](docs/10-development.md) · [Collectors](docs/02-collectors.md) · [Native workspace](docs/features/03-macos-agent-workspace.md) · [Basalt UI](docs/13-basalt-workspace.md) · [Local envs](docs/12-local-environments.md) · [Release](docs/11-agent-release.md) · [Retrospective](Retrospective.md)

## Commands

Run from root with Bun (`1.4.2` in CI), Node `>=26.12.1`, `gitleaks`, and `osv-scanner`. Native checks require macOS, full Xcode, and `xcodegen`. Local variable names live in `.env.example` (interactive Prod only -> `apps/web/.env`).

Before `test:l2` or browser E2E, build in order: `bun run --cwd packages/core build && bun run --cwd apps/cli build && bun run --cwd packages/api build && bun run build` (no Cloudflare credentials needed). If incremental `.tsbuildinfo` outlives missing outputs, run `bunx tsc -b packages/core apps/cli --force`.

```sh
bun install --frozen-lockfile
bun run dev                        # local Demo/E2E/Prod gateway -> 127.0.0.1:7019
bun run dev -- --mode e2e          # interactive switchable E2E
bun run dev:built                  # locally served production SPA build
bun run demo:reset                 # stop the interactive server first
bun run typecheck                  # S1: tsc -b across all 5 TS workspaces
bun run lint                       # S2: Biome check-only, 0 warnings
bun run build                      # B1: apps/web SPA bundle
bun run test:coverage              # L1: >=80% statements/branches/functions/lines
bun run deploy:check               # P1: SPA build + wrangler deploy --dry-run
bun run test:worker                # L2: apps/api Cloudflare Worker tests
bun run test:l2                    # L3: local Wrangler HTTP API + CLI integration
bun run test:e2e                   # L4: built SPA + locked local Worker (apps/web)
bun run test:e2e:bdd               # L4: BDD browser suite (same locked local runner)
bun scripts/verify-environments.ts # local env switching and isolation acceptance
bun scripts/verify-basalt.ts       # built SPA + disposable E2E all-route captures
bun run macos:test                 # native Swift/AppKit core + UI tests
bun run macos:package              # universal macOS app + standalone CLI verification
```

## Invariants

- Preserve complete source bytes and symlinks within collection policy; snapshot locally first, then upload identical immutable content. Collected user configurations may contain secrets.
- `packages/api` exports a runtime-agnostic Hono factory embedded by the sole Worker in `apps/api`; `/api/*` serves browsers and `/ingest/*` serves CLI/webhooks. Keep D1 indexes and R2 payloads coordinated.
- Access JWT verification falls through to verified Bearer tokens; never stamp identity by localhost or mode. Demo and E2E seed server-held fixture tokens into local D1.
- `bun run dev` runs the local-only Demo/E2E/Prod gateway; only interactive Prod injects `OTTER_DEV_API_TOKEN` from `apps/web/.env` to `https://otter.worker.hexly.ai`.
- Vite has no production proxy; automated E2E never reads daily `.env` files, refuses inherited Prod credentials, and disables server reuse.
- Build `packages/core` declarations before downstream TS reference checks. Keep `@nocoo/otter` (`apps/cli`) as the only npm package; `@otter/core` is type-only and unpublished.
- Keep root and workspace `package.json` dependency manifests synchronized with `bun.lock`.
- `apps/web` uses `@nocoo/basalt` ^3.5.1 ([docs/13-basalt-workspace.md](docs/13-basalt-workspace.md)); use published Basalt controls and tokens rather than raw controls or invented tokens.
- In-memory driver fakes do not prove D1 schema migrations or live storage behavior; verify migrations and real HTTP/CLI flows with `test:worker` and `test:l2`.
- Preserve trusted dev TLS and Vite host allowlists (`otter.dev.hexly.ai`); do not turn historical TLS workarounds into default checks.
- Native subprocess pipes (`apps/macos`) are protocols: order payloads, serialize writes and closes on the writer queue, report write errors instead of timing out, and never block the runner on open pipes.
- Releases follow [docs/11-agent-release.md](docs/11-agent-release.md) (9-file sync, changelog, tag, native artifacts). Worker CD tracks green CI; `npm publish`, signing, and real restore require explicit authorization.

## Quality & Local Gates

Follows `system1-quality`; CI slot definitions and pinned `base-ci` revision live in `.github/workflows/quality-slots.yml` (`quality / Z1: Gate` required on `main` and by `.github/workflows/release.yml`). Status vocabulary: `enforced`, `planned`, `manual`, `N/A`.

- **CI exceptions**: `S1`–`S3`, `G1`–`G2`, `B1`, `L1`–`L4`, and `P1` (`wrangler deploy --dry-run` reusing `B1` `apps/web/dist`) are `enforced`; `L2` runs `apps/api test` (`miniflare`/`workerd`) only. `@nocoo/otter` npm publish is `manual`.
- **L1 coverage boundary**: `vitest.config.ts` enforces >=80% on TS logic; excludes `apps/api/**` (`test:worker`), `.tsx` UI/hooks (`L4`), and thin entrypoints/infra glue.
- **Native macOS lane**: path-filtered `.github/workflows/macos.yml` runs `macos:test` and `macos:package`; Swift 95% coverage and strict static analysis remain `planned`.
- **Local hooks**: installed via `prepare` (`husky`, `.husky/`); `pre-commit` grades the staged index (never unstaged fixes), and checks forbid hook bypass or autofix.
- **`pre-commit`**: staged `gitleaks` (`G1`) + `git checkout-index` snapshot (`scripts/precommit.ts`) running staged Biome `--error-on-warnings` (`S2`), `test:coverage` (`L1`), and `tsc -b` (`S1`).
- **`pre-push`** (`.husky/pre-push`): parallel `osv-scanner` (`G2`), full-history `gitleaks git` (`G1`), and `test:l2` (`L3` local Wrangler API+CLI). Per-ref stdin OID isolation remains `planned`.

## Resources & Isolation

| Lane | Endpoint / State | Boundary |
| --- | --- | --- |
| Dev / Demo | `https://otter.dev.hexly.ai` -> `127.0.0.1:7019`; `apps/api/.wrangler/environments/demo` | Persistent local Demo (managed Worker on loopback port); stop server before `demo:reset`. Interactive Prod uses `apps/web/.env` |
| Tests (L3 / L4) | `127.0.0.1:27019` (`scripts/run-e2e-spa.ts`) / dynamic loopback (`scripts/run-api-e2e.ts`); fresh sibling dir + D1 marker | Run browser suites serially with each other and with SPA builds (`apps/web/dist`); cleanup verifies canonical path, owner, and D1 marker; never copy daily creds/snapshots |
| Prod | `https://otter.hexly.ai` (SPA + CF Access), `https://otter.worker.hexly.ai` (API/CLI); D1 `otter-db`, R2 `otter-snapshots` & `zhe` | Read-only checks (`bun run verify:web https://otter.worker.hexly.ai`) unless deployment is authorized; `workers_dev = false` |

See [docs/12-local-environments.md](docs/12-local-environments.md) for the full gateway, lock, and cleanup contract.

## Retrospective

Record incident narratives in [Retrospective.md](Retrospective.md); promote recurring project constraints to `Invariants` above and enforceable safeguards to tests/hooks.
