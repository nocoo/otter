# Otter

Configuration backup snapshots with a CLI, browser workspace and native macOS app.
Profile: ts-worker-web + native-tool (Swift/CLI).
Direction: [configuration backup design](docs/features/04-configuration-backup-redesign.md). Frameworks must preserve this handbook.

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
- Access authentication falls through to Bearer; `requireUser` owns rejection. Keep localhost-only dev identity stamping out of production.
- Vite dev may proxy a real Worker using `OTTER_API_URL` and `OTTER_DEV_API_TOKEN`; its env file is `apps/web/.env`. Automated tests must explicitly use the local runner.
- Build core declarations before downstream TypeScript reference checks. Keep `@nocoo/otter` as the CLI package; core type-only code is not separately published.

## Stack / Layout

| Component | Path / choice |
|---|---|
| Web / Worker | `apps/web` Vite/React; `apps/api` D1/R2/SPA assets |
| Shared / CLI | `packages/core`, `packages/api`, `apps/cli` |
| Native | `apps/macos`, Swift/AppKit; isolated build/test scripts |

## Commands

Run from root with Bun, Node 22.12+ (supported engine range in package.json), gitleaks and OSV. Native checks require macOS, full Xcode and xcodegen. Use local test-owned storage and fake data; no CF credentials are needed for local L2.

```bash
bun install --frozen-lockfile
bun run typecheck
bun run lint:biome
bun run build
bun run test:coverage
bun run test:worker
bun run test:l2
bun run test:e2e                 # built SPA + local Worker
bun run macos:test
bun run deploy:check             # build + local Worker dry run
```

## Verification

6DQ = L1/L2/L3 + G1/G2 + D1 (test isolation). Status: `enforced`, `planned`, `manual`, or `N/A`; partial enforcement below does not certify the full required bar.
L1 requires statements, branches, functions and lines each ≥95%, with no skipped/focused tests; preserve any stricter package threshold. Native tools must identify unmeasured metrics as gaps.
G1 requires check-only strict analysis/formatting with zero errors/warnings. G2 requires dependency and secret scans, with missing required scanners failing.

| Dimension | Status | Required proof and current evidence/gap |
|---|---|---|
| L1 TypeScript | planned | Hooks/CI run coverage with statements/lines 95%, branches/functions 94%; UI/auth/entry and Worker exclusions leave full all-four 95% incomplete. |
| L1 Swift | planned | Separate macOS CI runs native tests; no all-four 95% native coverage gate. |
| L2 HTTP / CLI | planned | `test:l2` boots local Wrangler and tests real API/CLI flows; require verified 100% route/auth/error coverage. Unit driver fakes are not real HTTP proof. |
| L3 web / native | planned | `test:e2e` serves built SPA/local Worker; macOS CI checks real AppKit and packaged CLI. Full page/desktop coverage is not enforced; root BDD uses a Vite proxy and needs explicit local target. |
| G1 TypeScript / Swift | planned | TS build/typecheck and Biome run in CI; `lint` is only typechecking, Biome lacks errors-on-warnings outside lint-staged, and strict native analysis is incomplete. |
| G2 | enforced | Hooks/CI require OSV and gitleaks, including full-history pre-push scanning. |
| D1 | planned | L2 is local with an inserted marker, but fixed `.wrangler/e2e` is recursively deleted without marker/path checks; browser fixed state and server reuse also need guards. |

Pre-commit runs staged Biome, plain unit tests, project-reference typecheck and staged gitleaks in parallel. Pre-push runs coverage, local L2, OSV and full-history gitleaks in parallel. CI adds Worker/build/browser gates and path-filtered macOS test/package jobs. Hooks inspect working files, not every pushed commit.

Target hooks: pre-commit checks G1 + L1 against the index snapshot (`git checkout-index`) in <30s; pre-push checks L2 and G2 in parallel against every stdin push ref/commit in <3min, plus build where applicable. L3 runs in CI or an explicit manual lane.
Never bypass commit/push hooks, force-push, or use autofix in checks. Documentation changes do not authorize deploying or implementing new gates.

## Resources / Isolation

Dev: Vite 7019 and Worker 7020. L2 defaults to loopback 17020 (`OTTER_L2_PORT`), using `apps/api/.wrangler/e2e`; browser runner uses 27019. Serialize fixed-state runners. Required direction is unique per-run local D1/R2 directories, checked test marker and canonical-path/ownership guards before cleanup. Never copy daily credentials or snapshots into fixtures.

## Operations / Release

Use [release procedures](docs/11-agent-release.md) for the nine-file version sync, changelog, build, commit/tag/push and native artifacts. Worker CD follows CI. npm publication is user-initiated only; do not infer it from a Git release. Keep release/package signing and real restore acceptance explicit.

## Retrospective

Move accident narratives to [Retrospective.md](Retrospective.md); keep at most about ten concise recurring project rules here. Put architecture and operational detail in linked docs.

- Root and workspace dependency manifests must change together with the lockfile.
- A local API fake does not validate schema migration or live storage behavior.
- Preserve trusted dev TLS and host allowlists; do not turn historical TLS workarounds into default checks.
