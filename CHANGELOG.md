# Changelog

All notable changes to this project will be documented in this file.

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
