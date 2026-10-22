# Otter

Configuration backup snapshots with a CLI, browser workspace and native macOS app.
Profile: ts-worker-web + native-tool (Swift/CLI).
Human overview: [README.md](README.md). Direction: [configuration backup design](docs/features/04-configuration-backup-redesign.md). Frameworks must preserve this handbook. Maintain this root `AGENTS.md` as the only project handbook; do not create a `CLAUDE.md` alias, copy or import.

## Sources of Truth

This file is the quality contract; hooks, CI and config are enforcement. Close implementation gaps without lowering the contract. Historical test results are not evidence of a current passing run.

| Fact | Where |
|---|---|
| Product / setup | [README.md](README.md), [development](docs/10-development.md) |
| Native / collection | [native workspace](docs/features/03-macos-agent-workspace.md), [collectors](docs/02-collectors.md) |
| Version / release | root `package.json`, [release procedure](docs/11-agent-release.md) |
| Test truth | `vitest*.ts`, `scripts/run-api-e2e.ts`, `scripts/run-e2e-spa.ts`, hooks/CI |
| Accidents | [Retrospective.md](Retrospective.md) |
| Machine workflow | global `AGENTS.md` and Git rules |

## Project Invariants

- Preserve complete source bytes/symlinks within the collection policy; snapshot locally first, then upload identical immutable content. Collected user configuration may contain secrets.
- `packages/api` exports a runtime-agnostic Hono factory, embedded by the sole Worker in `apps/api`; `/api/*` serves browsers, `/ingest/*` the CLI. D1 indexes and R2 payloads stay coordinated.
- Access authentication falls through to verified Bearer tokens; no localhost or mode-based identity stamping. Demo/E2E seed server-held fixture tokens into local D1.
- `bun run dev` launches the local-only Demo/E2E/Prod gateway. Only interactive Prod uses `OTTER_DEV_API_TOKEN` from `apps/web/.env` against the fixed production API. Vite has no production proxy; automated E2E never reads daily env files.
- Build core declarations before downstream TypeScript reference checks. Keep `@nocoo/otter` as the CLI package; core type-only code is not separately published.

## Stack / Layout

| Component | Path / choice |
|---|---|
| Web / Worker | `apps/web` Vite/React + `@nocoo/basalt` 2.2.0; `apps/api` D1/R2/SPA assets |
| Shared / CLI | `packages/core`, `packages/api`, `apps/cli` |
| Native | `apps/macos`, Swift/AppKit; isolated build/test scripts |

## Commands

Run from root with Bun, Node 22.23.4+ (supported engine range in package.json), gitleaks and OSV. Native checks require macOS, full Xcode and xcodegen. Before L2, build `packages/core`, `apps/cli`, `packages/api` in that order with `bun run --cwd <path> build`, then the SPA; the runner needs compiled CLI and static assets. If incremental metadata survives missing outputs, regenerate them with `bunx tsc -b packages/core apps/cli --force`. No CF credentials are needed for local L2.

```bash
bun install --frozen-lockfile
bun run typecheck
bun run lint:biome
bun run build
bun run test:coverage
bun run test:worker
bun run test:l2
bun run test:e2e                 # built SPA + locked isolated local Worker
bun run test:e2e:bdd             # same local-only runner, never Vite/prod proxy
bun scripts/verify-environments.ts # local switching and isolation acceptance
bun scripts/verify-basalt.ts       # built SPA, disposable rich E2E, all-route captures
bun run macos:test
bun run deploy:check             # build + local Worker dry run
```

## Verification

6DQ = L1/L2/L3 + G2 + D1 (test isolation); the former G1 dimension was merged into L1 on 2026-09-21. Status: `enforced`, `planned`, `manual`, or `N/A`; partial enforcement below does not certify the full required bar.
L1 requires statements, branches, functions and lines each ≥95%, with no skipped/focused tests; preserve any stricter package threshold. Native tools must identify unmeasured metrics as gaps. L1 also includes check-only strict analysis/formatting with zero errors/warnings (the former G1 contract). G2 requires dependency and secret scans, with missing required scanners failing.

| Dimension | Status | Required proof and current evidence/gap |
|---|---|---|
| L1 TypeScript | planned | Hooks/CI run coverage with statements/lines 95%, branches/functions 94%; UI/auth/entry and Worker exclusions leave full all-four 95% incomplete. |
| L1 Swift | planned | Separate macOS CI runs native tests; no all-four 95% native coverage gate. |
| L1 static (former G1, TypeScript / Swift) | planned | TS build/typecheck and Biome run in CI; `lint` is only typechecking, Biome lacks errors-on-warnings outside lint-staged, and strict native analysis is incomplete. |
| L2 HTTP / CLI | planned | `test:l2` boots local Wrangler and tests real API/CLI flows; require verified 100% route/auth/error coverage. Unit driver fakes are not real HTTP proof. |
| L3 web / native | planned | `test:e2e` serves built SPA/local Worker; macOS CI checks real AppKit and packaged CLI. Full page/desktop coverage is not enforced; both browser configs now use the locked local-only runner. |
| G2 | enforced | Hooks/CI require OSV and gitleaks, including full-history pre-push scanning. |
| D1 | planned | Local launchers allocate unique E2E D1/R2 state and identity, validate canonical path/owner and D1 markers before cleanup, and reject Prod credentials. Browser server reuse is disabled. Whole-repo isolation and external-boundary coverage remain incomplete. |

Pre-commit runs staged Biome, plain unit tests, project-reference typecheck and staged gitleaks in parallel. Pre-push runs coverage, local L2, OSV and full-history gitleaks in parallel. CI adds Worker/build/browser gates and path-filtered macOS test/package jobs. Hooks inspect working files, not every pushed commit.

Target hooks: pre-commit checks unified L1 (types, check-only lint, coverage) against the index snapshot (`git checkout-index`) in <30s; pre-push checks L2 and G2 in parallel against every stdin push ref/commit in <3min, plus build where applicable. L3 runs in CI or an explicit manual lane.
Never bypass commit/push hooks, force-push, or use autofix in checks. Documentation changes do not authorize deploying or implementing new gates.

## Resources / Isolation

Local gateway: loopback 7019 through `https://otter.dev.hexly.ai`; managed Workers and L2 allocate loopback ports. Both browser suites use gateway 27019 and must run serially, without server reuse. Demo persists in `apps/api/.wrangler/environments/demo`; each E2E owns a fresh sibling directory, identity and D1 marker. Cleanup rejects foreign paths, symlinks and ownership/marker mismatch. Never copy daily credentials or snapshots into fixtures. See [local environments](docs/12-local-environments.md).

```bash
bun run dev                     # preference, then Demo
bun run dev -- --mode e2e        # interactive, switchable E2E
bun run dev:built                # locally served production build
bun run demo:reset               # stop the interactive server first
```

## Operations / Release

Use [release procedures](docs/11-agent-release.md) for the nine-file version sync, changelog, build, commit/tag/push and native artifacts. Worker CD follows CI. npm publication is user-initiated only; do not infer it from a Git release. Keep release/package signing and real restore acceptance explicit.

## Retrospective

Move accident narratives to [Retrospective.md](Retrospective.md); keep at most about ten concise recurring project rules here. Put architecture and operational detail in linked docs.

- Root and workspace dependency manifests must change together with the lockfile.
- A local API fake does not validate schema migration or live storage behavior.
- Preserve trusted dev TLS and host allowlists; do not turn historical TLS workarounds into default checks.
