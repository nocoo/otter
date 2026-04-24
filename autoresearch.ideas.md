- Investigate `packages/cli/src/__tests__/snapshot/builder.test.ts` ~25% flakiness on the two `omits computerName ...` tests. Pre-existing — `vi.mock("node:os")` factory replacement of `platform` binding doesn't always intercept calls from `builder.ts` (likely vitest+bun ESM hoist race when run with low concurrency contention). Was masked when test suite ran for ~6s (slow d1 retries) but surfaces now that the suite is ~0.6s. Stable repro: run `bun run test:coverage` 8x in a tight loop. Worth migrating those 2 assertions to use a real subprocess fake or to a separate test file with `vi.doMock` in a beforeEach.
- Consider migrating the unit-test runner from vitest to `bun test`. Vitest startup + transform floor is ~0.55s on this codebase; `bun test` is reportedly 5-10x faster but requires rewriting `vi.mock` to bun's mock API and dropping `@vitest/coverage-v8` (need a bun-compatible coverage gate). Likely brings precommit_s under 0.4s but is a multi-day refactor.
- `vitest --changed HEAD --passWithNoTests` for pre-commit reduces the unit stage to vitest's 0.4s startup floor when the staged set has no source changes (e.g. doc-only commits), and runs only directly-affected tests otherwise. Saves up to 200ms on unit_cov but is a real semantic weakening of the L1 gate at commit time (full coverage still enforced at pre-push). Defer until pre-push velocity becomes acceptable in CI.
- Replace `bunx lint-staged` with `biome check --staged --write` directly in the hook (saves ~60ms of lint-staged wrapper overhead). lint-staged also auto-`git add`s rewritten files; need to add an explicit `git diff --name-only --cached --diff-filter=AM | xargs -r git add` step. Lint isn't on the critical path though, so wall-clock impact is zero — only matters if the parallel structure changes.

## Tried & rejected (do NOT re-explore)
- Merging lint+gitleaks into a single bg subprocess (`sh -c 'lint-staged && gitleaks'`) to drop parallel stages from 4 to 3 — isolated test showed +50ms gain but in the actual hook, `sh -c` overhead nudged unit_cov_s from 0.62s → 0.66s (median 0.78s vs prior 0.72s). Slight regression.
- `nice -n 19` for non-unit stages — no measurable change on macOS scheduler with 16 cores.
- `pool: "threads", isolate: false` — breaks `builder.test.ts` mock isolation.
- `pool: "vmForks"` — slower than vmThreads.
- `pool: "vmThreads", singleThread: true` — 3x slower (no parallelism).
- `--no-file-parallelism` — 3x slower.
- vitest reporter swap (`basic`, `dot`, `tap`) — no change.
- `--bail=1` — no change (all tests pass).
- `--reporter=basic` / `--silent` — no change.
- `node node_modules/vitest/vitest.mjs run` vs `bunx vitest run` — same speed.
- Sharding into 2 parallel vitest processes (cli vs web+api) — slower due to dual startup + CPU contention.
- `vmThreads.maxThreads` sweep: 4 (0.78s), 6 (0.65s), 8 default (0.63s), **12 best (0.57s isolated)**, 16 (0.61s), 32+ (0.67s+). 12 chosen.
- Vitest workspace mode (one config per package, sharded run) — same conclusion as positional sharding above.
- Moving `test:coverage` back to pre-commit — strictly worse (0.95s vs 0.69s wall).

## Current floor
~0.68-0.74s wall (median 0.69s), bottleneck is vitest's own startup (~0.55s for transform + collect) plus parallel-stage shell coordination. Further wins require either a different test framework (`bun test`) or weakening the pre-commit semantic contract.
