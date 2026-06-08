# Changelog

All notable changes to this project will be documented in this file.

## [2.0.2] - 2026-06-08

### Changed
- Untrack .wrangler/tmp build artifacts
- Upgrade @cloudflare/workers-types 4.20260606.1 → 4.20260608.1

## [2.0.1] - 2026-06-06

### Features
- Add E2E_SKIP_AUTH bypass for local wrangler dev
- Add automated release script with CHANGELOG generation
- Include version in /api/live response (per release convention)

### Changed
- Upgrade lucide-react 0.577 → 1.17.0 (major)
- Upgrade lint-staged 16.4.0 → 17.0.7 (major)
- Upgrade @cloudflare/vitest-pool-workers 0.8.71 → 0.16.13 (major)
- Upgrade vitest 3.x → 4.1.8, @vitest/coverage-v8 → 4.1.8 (major)
- Upgrade TypeScript 5.9 → 6.0.3 (major)
- Bump shiki 4.0.1 → 4.2.0 (minor)
- Bump radix-ui 1.4.3 → 1.5.0 (minor)
- Bump react-router 7.6.3 → 7.17.0 (minor)
- Bump @cloudflare/workers-types 20250327 → 20260606 (minor)
- Bump wrangler 4.80.0 → 4.98.0 (minor, update override)
- Bump vitest 3.0.0/3.2.4 → 3.2.6, @vitest/coverage-v8 → 3.2.6 (minor)
- Bump vite 7.3.2 → 8.0.16 (patch, update override)
- Bump react 19.2.4 → 19.2.7, @types/react 19.2.14 → 19.2.17 (patch)
- Bump @types/node 25.3.4 → 25.9.2 (api, cli)
- Bump @biomejs/biome 2.4.8 → 2.4.16 (patch)
- Bump hono 4.12.18/21 → 4.12.23 (patch)
- Add packageManager bun to wrangler-action
- Bump wrangler-action v3 → v4 for Node 22+
- Ignore devalue dev-only OSV (vitest-pool-workers transitive)
- Pass --ignore-scripts to bun install (Shai-Hulud defense)
- Add typecheck script alias
- Rewrite run-api-e2e.ts to use --local --persist-to
- Align coverage config with pew best practices
- Standardize release workflow to dove template
- Rotate CF_ACCESS_AUD for prod and test envs
- Split CD into separate workflow, trigger via workflow_run
- Build packages individually instead of tsc -b
- Build cli/dist before L2 so CLI binary tests can spawn it
- Expect 403 for bogus Bearer (apiKeyAuth runs before /api/me)
- Wrap long pre-commit success line per biome formatter
- Add CD jobs (deploy worker to test → prod after L2)
- Add L2 API E2E job (real HTTP vs otter-db-test)
- Wire test:l2 into pre-push and document the gate
- Add CLI binary E2E (--help, config CRUD, real token round-trip)
- Add CRUD round-trip + ingest tests
- Add API smoke tests over real HTTP
- Scaffold real-HTTP API E2E runner against CF remote
- Final session log (55 experiments, -91% pre-commit)
- Stability sample + ideas pruned
- 5x stability sample
- Stability sample (post-discard) + idea pruning
- Doc updates (autoresearch.md, ideas) + stability sample
- Restore sh wrapper for husky pre-commit hook (husky sources hooks via sh, ignoring shebang)
- Spawn binaries directly from node_modules/.bin (skip bun run indirection)
- Stability sample (Bun.spawn hook)
- Replace bash-orchestrated pre-commit hook with Bun.spawn TS script
- Stability sample (lower end)
- 5x stability sample post-maxThreads bump
- Bump vmThreads maxThreads to 12 (was default 8)
- Stability sample; capture remaining ideas
- Update autoresearch.md summary with 89.5% reduction final state
- Move coverage from pre-commit to pre-push (gate still enforced before push)
- Update autoresearch.md summary doc
- Stability sample — sub-1s confirmed
- Replace 4 parallel tsc --noEmit with single tsc -b incremental build
- Switch vitest pool: threads -> vmThreads for ~15% faster test runs
- Vitest pool=threads with isolate=true (correctness-safe; ~30% faster than forks)
- Re-measure to confirm sub-1s
- Parallelize core+api+web typecheck (cli still serialized after core)
- Raise branch coverage threshold 88 → 94 (now 95.04% global)
- Cover NODE_ENV fallback and undefined c.env branches
- Cover login timeout branch + icons whitespace/no-callback branches
- Tsc incremental cache (re-applied without breaking pool config)
- Cover vscode parseExtensionDirName fallback branches
- Stub setTimeout in create-app.test.ts to skip d1 retry backoffs from /v1/live
- Parallelize tsc --noEmit for cli/web/api after core emit
- Stub setTimeout in d1.test.ts beforeEach to skip 200/400ms retry backoffs
- Bring 4 collector branches to 100% (cloud-cli, homebrew, launch-agents, macos-defaults)
- Parallel pre-commit hook timing. Bottleneck=unit_cov (vitest+coverage v8).
- Bump dev-toolchain branch coverage 61.53%→92.85%
- Prune unused @otter/api exports subpaths
- Archive next.js retrospective entries, frame vite as first-class
- Add hermes collector to rich-snapshot fixture (sync with cli/src/collectors)
- Move ui.test.ts under src/__tests__/utils/ to match layout
- Sync quality gate tables with actual L1+G1+G2 layout (no L2/L3/D1)
- Restore base-ci v2026.1 quality workflow (G1+L1+G2+tsc)
- Parallelize pre-commit (G1+L1+tsc+gitleaks) and pre-push (osv+gitleaks)
- Bump schema URL to 2.4.10 to match CLI
- Raise coverage thresholds to 95/89/95/95
- Add branch tests for routes + middleware
- Add branch tests for update/builder/docker/fonts/icons-server

### Fixes
- Upgrade wrangler-action v3 to v4 and fix OSV vulnerabilities
- Pin Node 22 for L2 job (wrangler 4.x requirement)
- Resolve hono override conflict + use bunx for wrangler
- Upgrade hono to fix CVEs + add osv-scanner.toml
- Env-guard production safety + stale doc references
- Handle env-guard + Bearer passthrough in E2E_SKIP_AUTH
- Remove hardcoded version assertion and guard release main()
- Correct logo path in README
- Correct collapsed logo padding to pl-6 per B02-2c
- Emit plain Configuration header before consola box in config show
- Assert camelCase fileCount from /api/snapshots
- Upsert users row before INSERT INTO webhooks
- Mount real /api/live with driver-aware D1 probe
- Treat ENVIRONMENT=test as localhost for L2 e2e
- Override top-level routes in [env.test] to empty
- Switch L2 runner + CLI E2E from bun.spawn to node:child_process
- Pin postcss>=8.5.10 (GHSA-qx2v-qp2m-jg93 via vite transitive dep)
- Lower branches threshold to 88% (CI v8 reports 88.9 vs local 89.04)

### Removed
- Remove orphaned vitest sub-configs superseded by root config
- Delete verify-test-resources.ts (no longer needed)
- Remove references to remote test resources and deploy:test
- Remove CF secrets from L2 job, simplify pre-push
- Remove [env.test] from wrangler.toml and deploy:test scripts
- Remove --env test, use --local with dynamic migrations
- Remove ENVIRONMENT=test bypass from isLocalhost()
- Drop stale osv-config reference (file removed in 8c31ffc)
- Cover 401 branches for webhooks POST/GET/PATCH/DELETE :id
- Cover 401 branches for snapshots/:id and webhooks POST/PATCH/DELETE/:id
- Drop obsolete osv-scanner ignore (next.js PPR vuln no longer in tree)
- Drop obsolete fast-xml-parser/flatted overrides (no longer in dep tree)
- Drop next.js historical references, bump vite 6→7 in active docs
- Drop next.js residue from biome domains + vitest exclude
- Drop stale L2 e2e suite (BASE_URL pointed at deleted web_legacy :17019)

## [2.0.0] - 2026-04-24

Major release: web stack rewrite + single Cloudflare Worker + auth overhaul.

### Breaking

- **Web stack**: `packages/web` rewritten from Next.js 16 + next-auth to Vite 6 SPA + React 19 + react-router 7 + SWR + Tailwind v4. Old `packages/web_legacy` deleted.
- **Hosting**: Single Cloudflare Worker now hosts both `/api/*` (D1 binding) and SPA static assets. Web container (Railway) retired.
- **Auth**: Browser auth switched from Google OAuth (next-auth) to Cloudflare Access SSO (`Cf-Access-Jwt-Assertion`). CLI auth switched to opaque Bearer tokens (`api_tokens` D1 table) minted via `/api/auth/cli`.
- **Removed `/v1/snapshots` + `/v1/webhooks`** (HTTP-D1 forward layer). SPA uses `/api/*`, CLI uses `/ingest/*`. `apiKeyMiddleware` + `X-User-ID` + `Env.API_KEY` dropped.
- **D1 user_id migration**: `users.id` / `webhooks.user_id` / `snapshots.user_id` migrated from Google OAuth `sub` to email (`0003_user_id_to_email.sql`). Old R2 prefixes preserved via persisted `r2_key` column.
- **`@otter/api` no longer ships HTTP-D1 client**: `worker-client.ts`, dead `routes/snapshots.ts` + `routes/webhooks.ts`, next-auth `middleware/auth.ts` deleted. `@auth/core` + `@aws-sdk/client-s3` removed from deps.

### Features

- **`createApp({ basePath, driver, bucket, auth })`**: `@otter/api` exposes a route-factory entrypoint consumed by the worker (D1 binding driver).
- **Custom domains**: `otter.hexly.ai` (CF Access) + `otter.worker.hexly.ai` (Bearer-only, CLI ingest) on the same worker, plus `*.workers.dev` fallback.
- **Surety dev mode**: vite dev server proxies `/api/*` to the production worker with `Authorization: Bearer <OTTER_DEV_API_TOKEN>` injected — bypasses CF Access SSO for local development.

### Infrastructure

- New `packages/worker` — Hono on Cloudflare Workers, ingest + assets + `/api/*` adapter.
- `[assets]` block in `wrangler.toml` serves SPA fallback with `not_found_handling = "single-page-application"`.
- Quality gates: 502 vitest tests + tsc strict + Biome strict + osv-scanner + gitleaks + Playwright (28 tests / 6 specs).

## [1.5.1] - 2026-04-16

### Fixes

- **E2E test runner**: Fixed L2 API E2E tests — test runner was using production Worker URL instead of test Worker, causing 401 on ingest calls
- **Playwright tests**: Updated snapshot detail assertions to match redesigned dashboard UI (removed "12 collectors captured" text replaced by category breakdown)
- **Dependencies**: Fixed 11 vulnerabilities — hono ≥4.12.14, @hono/node-server ≥1.19.13, next 16.2.3, vite ≥7.3.2

## [1.5.0] - 2026-04-16

### Features

- **Hermes Agent collector**: New collector backing up Hermes AI agent profiles (`~/.hermes/`)
  - Collects `config.yaml`, `SOUL.md`, `memories/`, `cron/jobs.json` per profile
  - Lists skills by directory name (content not collected)
  - Supports main profile and named sub-profiles under `~/.hermes/profiles/`
  - Silently skips when Hermes is not installed

### Fixes

- **YAML redaction**: Fixed multiple gaps in YAML secret redaction
  - List items (`- token: abc`) now properly redacted
  - Block scalar continuation lines (`key: >\n  secret`) no longer leak values
  - Kebab-case keys (`api-key`, `auth-token`) now matched by sensitivity patterns
  - Block scalars with trailing comments (`key: > # comment`) handled correctly
  - Both indicator orderings supported per YAML 1.2 spec (`|2-`, `>1+`)
- **Hermes error handling**: Distinguished ENOENT (not installed) from EACCES (permission denied) — no longer shows misleading "not installed" skip message on permission errors
- **Hermes list item uniqueness**: Used qualified names (`profile:name`, `profile/skill`) to prevent snapshot diff from swallowing changes when profiles share skill names

### UI Improvements

- **Dashboard redesign**: Redesigned Breakdown section cards with `DashboardSegment` and `StatCard` components
- **Card styling**: Removed border and shadow from Card, using `bg-secondary` for visual hierarchy

### Chores

- **CLI login**: Migrated to cli-base 0.2.0 with mandatory CSRF and accentColor support
- **Quality gates**: 451+ tests maintained

## [1.4.1] - 2026-04-05

### Chores

- **Code cleanup**: Removed deprecated Next.js webhook routes (`/api/webhook/[token]`) after Worker migration
  - CLI now uses Worker `/ingest/{token}` directly
  - Deleted R2 S3 API client (`lib/cf/r2.ts`) - no longer needed
  - Removed 50 obsolete unit tests
- **Worker rename**: Changed Worker name from `otter-api` to `otter`
  - Production: `https://otter.worker.hexly.ai`
  - Test: `https://otter-test.nocoo.workers.dev`
- **E2E test update**: Ingest E2E test now calls Worker directly instead of deprecated Next.js route

### Quality

- Test count: 456 → 406 (removed deprecated tests, coverage maintained at 91.85%)

## [1.4.0] - 2026-04-05

### Features

- **Cloudflare Worker API (Phase 1-3)**: Complete migration of data access layer from D1 REST API to Cloudflare Worker with native bindings
  - New `packages/worker` package with Hono framework
  - `/ingest/{token}` and `/ingest/{token}/icons` routes (CLI upload)
  - `/v1/snapshots` and `/v1/webhooks` routes (Dashboard read API)
  - BFF pattern: Next.js API routes now forward to Worker with `X-API-Key` + `X-User-ID` headers
  - Performance: D1 query latency reduced from 200-500ms to <20ms
- **CLI Worker migration**: Default upload URL now points to Cloudflare Worker (`otter-api.nocoo.workers.dev`)
  - Added `OTTER_API_URL` environment variable for custom Worker URL
- **Dashboard charts**: Added Recharts-based data visualizations (area charts, bar charts)
- **Snapshot list UX**: Enhanced table row clickability with hover states

### Fixes

- **Suspense boundary**: Wrapped `useSearchParams` in Suspense for `/cli/connect` page
- **E2E test selectors**: Fixed Playwright tests to use `getByText` for table row navigation (pages use `<tr onClick>` not `<a>` links)

### Chores

- **Security**: Updated wrangler to 4.80.0 (CVE fix), added override for transitive dep
- **Test infrastructure**: Deployed `otter-api-test` Worker with isolated D1/R2 for E2E testing
- **Quality gates**: 456 unit tests (92.33% coverage), 22 L2 API E2E tests, 28 L3 Playwright tests

## [1.3.6] - 2026-04-04

### Fixes

- **B-1 Login security**: Added `sanitizeCallbackUrl()` to prevent open-redirect attacks via `callbackUrl` query parameter
- **B-5 Dark mode**: Corrected L3 input brightness from 12% to 18% per Basalt color system standard

### UI Improvements

- **B-2 Version badge**: Aligned version badge styling to `rounded-md bg-secondary` per Basalt standard
- **B-4 Skeleton loading**: Replaced spinner with proper skeleton states matching dashboard layout structure
- **StatCard styling**: Updated to use `--radius-card` and added icon container with L1 background for visual depth

### Chores

- **B-3 Logo naming**: Renamed `otter.png` to `logo.png` (Basalt standard naming convention)
- **Dev port migration**: Changed dev server port from 7029 to 7019

## [1.3.5] - 2026-03-30

### Fixes

- **Claude config collector**: Raised `history.jsonl` max size from 2MB to 5MB to prevent "exceeds size limit" error on large prompt histories

## [1.3.4] - 2026-03-30

### Fixes

- **Biome G1 strict compliance**: Upgraded all linter rules from `warn` to `error` level for full G1 gate compliance
- **Transitive dependency vulnerabilities**: Pinned `brace-expansion >=5.0.5`, `path-to-regexp >=8.4.0`, `picomatch >=4.0.4` via overrides to resolve 8 osv-scanner findings (3 High, 5 Medium)

### Chores

- Removed unused `eslint` and `eslint-config-next` from web devDependencies

## [1.3.3] - 2026-03-24

### Quality

- **Pre-commit coverage enforcement**: Pre-commit hook now runs `test:coverage` instead of bare `test`, ensuring 90% threshold gates are enforced on every commit
- **Biome strict preset**: Promoted 12 linter rules to `error` level (`noExplicitAny`, `useExportType`, `useImportType`, `useTemplate`, `useForOf`, `noUselessElse`, etc.) for stricter code quality
- **TypeScript strict extras**: Enabled `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`, `noUnusedLocals`, `noUnusedParameters`, `noFallthroughCasesInSwitch` across all packages
- **Playwright E2E expansion**: Grew from 1 spec / 3 tests to 6 specs / 28 tests covering navigation, dashboard, snapshots list, snapshot detail, and settings pages

### Fixes

- **25 TypeScript strict errors**: Added null guards, conditional spreads, and type narrowing across 12 CLI files to satisfy new strict compiler options
- **Playwright strict mode**: Resolved 4 strict-mode violations (ambiguous selectors) in E2E tests with `{ exact: true }`, `.first()`, and role-based locators

### Infrastructure

- **D1/R2 test isolation**: Added env-override guards and `_test_marker` validation so E2E runners use dedicated test resources, never production
- **E2E env loading**: `.env` is now loaded in E2E runners for Cloudflare credentials

## [1.3.2] - 2026-03-23

### Quality

- **S-tier quality gates**: Upgraded project from Tier C to Tier S by implementing full mem6 quality framework
- **Biome 2.4 linter**: Added Biome with strict rules (recommended + all groups at error level) as the project linter and formatter, replacing tsc-only checks
- **lint-staged**: Incremental Biome lint+format on staged files via pre-commit hook (replaces full-repo checks)
- **Security scanning**: Added osv-scanner (dependency vulnerabilities) and gitleaks (secret detection) as pre-push hard gates
- **Husky hooks restructured**: pre-commit runs G1 (Biome) + L1 (tests) + tsc; pre-push runs G2 (security) + L2 (API E2E) + L3 (Playwright)

### Fixes

- **Dependency vulnerabilities**: Upgraded next 16.1.6 → 16.2.1, added overrides for fast-xml-parser, flatted, and hono to resolve 10 known CVEs
- **React key props**: Replaced array index keys with content-based keys in collector cards and overview tab
- **Non-null assertions**: Replaced `!` assertions with proper null checks and type narrowing across CLI and web
- **Accessibility**: Added `type="button"` attributes and ARIA labels to interactive elements
- **Import organization**: Applied Biome import sorting and formatting across 126 files

## [1.3.1] - 2026-03-21

### Testing

- **L1 coverage boost**: Added unit tests for D1 client (env validation, query/execute/batch, retry, errors), R2 client (put/get/delete/exists for snapshots and icons), snapshot detail helpers (pure functions), and CLI UI module (formatters, table, tree, console output) — 88 new test cases
- **Coverage exclusions**: Excluded `.tsx` components, hooks, palette, auth glue, and other UI-only files from coverage calculation
- **Coverage threshold met**: Overall coverage raised from 78.6% to 94.3% (all 4 metrics above 90% threshold)

### Fixes

- **Fallback icon**: Show placeholder icon when app icon fails to load

## [1.3.0] - 2026-03-09

### Refactoring

- **Snapshot detail page rewrite**: Decomposed monolithic 614-line page into 8 focused modules with Radix Tabs (Overview, Config, Environment) replacing the custom Segment Bar
- **Consistent Card component usage**: Replaced hand-built divs with shadcn Card throughout snapshot detail, following the project's 3-tier luminance system (L0 background → L1 card → L2 secondary)
- **Metadata icons convention**: Migrated `icon.png`, `apple-icon.png`, and `opengraph-image.png` to Next.js file-based metadata convention

### Fixes

- **Sub-card visual separation**: Inner cards now use `bg-secondary` + `border-border/50` to properly stand out from their Card containers
- **Card shadow reduction**: Lightened global Card shadow from `shadow-sm` to `shadow-xs` for a cleaner aesthetic
- **Section padding**: Increased divider section padding in collector cards for better readability
- **Login page logos**: Added 80px and 160px to allowed image sizes for login page provider logos

## [1.2.1] - 2026-03-08

### Fixes

- **Spacing consistency**: Fixed spacing alignment across all CLI output elements

## [1.2.0] - 2026-03-08

### Features

- **Scan spinner**: Each collector now shows a spinning indicator while running, replaced by the result line on completion — slow collectors like Homebrew no longer feel stalled
- **Skipped vs errors**: Tools that aren't installed (volta, pyenv, rbenv, go, etc.) are now reported as "skipped" instead of "errors" — clean separation between real failures and safe skips
- **UI primitives**: New `ui.ts` module centralizes all terminal output formatting (banner, items, tables, trees, boxes, status lines) for consistent styling

### Refactoring

- **CLI output rewrite**: Migrated all `cli.ts` output from inline `console.log` + `consola` calls to the centralized `ui.ts` primitives
- **Flush-left output**: Removed all left margin/indentation from UI output — checkmarks, steps, tables, trees, and boxes now render flush to the terminal edge

### Dependencies

- Added `yocto-spinner` (~3KB) for lightweight terminal spinners

## [1.1.0] - 2026-03-07

### Features

- **Collector expansion**: Added VS Code, Docker, Fonts, Dev Toolchain, Cloud CLI, macOS Defaults, and Launch Agents collectors, while enhancing Homebrew and Applications coverage
- **Dashboard upgrades**: Snapshot detail now supports rich metadata badges, collector search/filter/grouping, and more stable list rendering for duplicate item names

### Fixes

- **Icon storage split**: Snapshot blobs continue writing to `otter-snapshots`, while app icons now write to the dedicated `zhe/apps/otter` bucket path
- **Icon extraction**: Application icon export now handles binary plist metadata so apps like Setapp, Outlook, Google Drive, and Xcode can be exported and uploaded correctly
- **Dev toolchain noise cleanup**: Removed spurious `fnm`, `rustup`, and `bun` output from collector results so the dashboard shows cleaner toolchain data

## [1.0.3] - 2026-03-07

### Features

- **Server-side icon upload**: `otter backup` now exports app icons and uploads them to the server via `POST /api/webhook/[token]/icons` — users no longer need to configure R2 credentials
- **Icon upload endpoint**: New `POST /api/webhook/[token]/icons` route on the web server that validates, stores icons in R2 with immutable caching

### Refactoring

- **Removed 5 R2 config fields**: `iconR2Endpoint`, `iconR2AccessKeyId`, `iconR2SecretAccessKey`, `iconR2Bucket`, `iconR2PublicDomain` removed from `OtterConfig` — zero config needed
- **Removed `@aws-sdk/client-s3` from CLI**: Icons go through the server now, so the CLI no longer needs the AWS SDK — significantly smaller package
- **Removed `--upload` flag from `export-icons`**: Command now only does local PNG export; upload happens automatically during `otter backup`
- **Deleted direct R2 uploader**: `packages/cli/src/uploader/icons.ts` and its 17 tests replaced by server-side flow

## [1.0.2] - 2026-03-07

### Refactoring

- **Config simplification**: `OtterConfig` now stores only `token` — removed `host` and `webhookUrl` fields
- **Dev/prod config separation**: `config.json` for production, `config.dev.json` for dev mode — `--dev` flag no longer leaks dev host into production config
- **Runtime URL construction**: `webhookUrl` is now built at runtime via `buildWebhookUrl(host, token)` instead of being persisted
- **Login flow streamlined**: CLI connect callback only returns `token`; `resolveHost` no longer reads from config

## [1.0.0] - 2026-03-07

### Features

- **Web Dashboard**: Full Next.js 16 dashboard with Google OAuth, deployed on Railway
  - Sidebar layout with collapsible navigation and version pill badge
  - Dashboard home page with real-time stats from D1/R2
  - Snapshots list with cursor pagination and detail viewer
  - Settings page with webhook management (CRUD)
  - File viewer modal with Shiki syntax highlighting, line numbers, word wrap, and light/dark theme adaptation
  - App icon display in snapshot detail (with client-side fallback for legacy snapshots)
  - SSH key detection indicators (green checkmarks, never backs up key content)
  - Loading screen and 404 page
  - Basalt design system with Teal/Cyan theme and shadcn/ui primitives
  - Health check endpoint (`/api/live`) with D1 connectivity probe and system metadata

- **CLI**: Full-featured backup tool for macOS developer environments
  - `scan` command to preview collectors without saving
  - `backup` command with webhook upload and local snapshot storage
  - `snapshot` commands: list, show, diff (file-level and list-level comparison)
  - `export-icons` command to extract app icons as PNG
  - `config` command for webhook and collector configuration
  - `--slim` flag to exclude behavior data from snapshots
  - `--json` flag for machine-readable output

- **Collectors**: 5 specialized data collectors
  - Shell config (dotfiles, SSH key detection, shell history)
  - Homebrew (formulae, casks, taps)
  - Applications (installed apps with icon extraction and R2 upload)
  - Claude config (targeted collection with session summaries)
  - OpenCode config (settings with credential redaction)

- **Security**: Multi-layer credential redaction
  - Shell script redaction for `export KEY=value` patterns
  - JSONL deep redaction for history files
  - Credential redaction for settings.json, .npmrc, .gitconfig, .netrc
  - SSH keys detected but never collected

- **Infrastructure**
  - Monorepo with Bun workspaces (`@otter/core`, `@otter/cli`, `@otter/web`)
  - Cloudflare D1 for metadata storage, R2 for snapshot blobs and app icons
  - Gzip-compressed webhook payloads
  - Docker multi-stage build for Railway deployment
  - 4-layer test architecture with 291+ passing tests
  - Husky pre-commit (UT + lint) and pre-push (E2E) hooks
  - Centralized version management across all packages

### Refactoring

- Deduplicate `formatSize` into shared `lib/utils`
- Harden base collector with directory exclusions, binary detection, and size caps

### Documentation

- Complete documentation tree with README entry point and detailed guides
- Dashboard design document with phased implementation plan
