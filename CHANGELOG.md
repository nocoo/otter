# Changelog

All notable changes to this project will be documented in this file.

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
