<p align="center">
  <img src="../assets/brand/icon-rounded.png" alt="Otter" width="128" height="128" />
</p>

<h1 align="center">Otter</h1>

<p align="center">Manage Agent configuration sources, protect local settings, and recover complete content.</p>

<p align="center">
  <a href="https://otter.hexly.ai">Website</a> ·
  <a href="../README.md">简体中文</a>
</p>

## What it does

Otter 3.0 manages multiple configuration repositories and folders on macOS. It captures Agent instructions, rules, commands and complete skill packages alongside software inventories, including unmanaged local resources, uncommitted files and readable symlink targets within the selected scope. Saved content can be recovered even when the original machine or repository is unavailable.

The CLI owns discovery and backup. The native Mac App manages local sources, Git status, Agent entries and backup tasks, while retaining its instruction and Skill editor. The web interface browses machine history, compares versions and downloads recovery archives. Copying recovered files into live settings and reinstalling software remain manual steps.

A single Cloudflare Worker serves the API and web interface. D1 holds users, tokens and snapshot indexes; R2 stores snapshot bodies and application icons. Snapshot lists and details are scoped to the signed-in email address.

## Features

- Register multiple Git repositories or ordinary folders in a shared Mac/CLI registry. Inspect branches, dirty files, conflicts, upstream differences and the last remote check.
- Capture known configuration entries for Claude Code, Codex, Grok, Pi, Hermes, OpenCode and Gemini CLI. Hermes default, named profiles and configured external skills retain their own identities.
- Save complete packages, scripts, references, small binary assets, directory and permission metadata, link chains and target bytes. Local resources need no prior Workflow registration.
- Keep 14 default collectors for Agent settings, shell settings, Homebrew, applications, editor extensions, Docker, fonts, toolchains, cloud CLIs, macOS preferences and LaunchAgent plist content. Applications include IDs, paths, versions and identifiable install sources.
- Save immutable local snapshots before uploading the same content. Durable receipts, a combined timeline, verification and download support retries and recovery.
- Compare content, permissions, links and inventory versions. Browse machine, source and Agent/profile history, search filenames/resources, inspect coverage and download individual files or complete recovery ZIPs.

v2 coverage records exclusions, redaction, inventory-only items, read failures and capture limits. “Complete” means complete within the recorded policy. `--slim` excludes only Claude prompt history and session summaries; Hermes memories and user profiles are still collected. Inspect the local snapshot before uploading. Legacy v1 snapshots remain readable, but skill names cannot recover content that was never saved. See [collection and snapshot scope](10-development.md#采集与快照边界).

## Usage

### Installation and local snapshots

See the [v3.0.0 GitHub Release](https://github.com/nocoo/otter/releases/tag/v3.0.0) for Mac downloads and upgrade notes. For self-hosted installations, upgrade the API before uploading full snapshots with the new clients.

Use macOS and Node.js. The repository declares the Node.js range `^22.12.0 || ^24.0.0 || >=26.0.0`.

```bash
npm install -g @nocoo/otter
otter --help
otter source add /absolute/path/to/workflow
otter source add /absolute/path/to/another-source
otter workspace inspect --json
otter scan --slim --save
otter snapshot list
```

Local snapshots live in `~/.config/otter/snapshots/`. Use a full ID or its first eight characters from the list to inspect or compare snapshots, replacing the example IDs with actual values:

```bash
otter snapshot show SNAPSHOT_ID
otter snapshot diff OLD_ID NEW_ID
otter snapshot export SNAPSHOT_ID --destination /absolute/path/to/new-recovery-folder
```

The destination must not exist. Exports include saved files, directories, permissions, original link mappings, coverage and software inventories without depending on the source repository. The shared registry is `~/.config/otter/workspace.json`; the Mac App merges its previous source settings on first launch.

### Cloud backups

The [website](https://otter.hexly.ai) requires an identity allowed by Cloudflare Access. Login opens a browser connection page and saves a token through a local callback:

```bash
otter login
otter backup --slim
otter snapshot timeline
otter snapshot verify SNAPSHOT_ID
otter snapshot download REMOTE_FULL_ID
```

`backup` scans again, saves locally, sends the snapshot to `https://otter.worker.hexly.ai/api/snapshots` with a Bearer token, and then uploads icons. Authentication or upload failures leave the local snapshot intact; retry that artifact with `otter backup --snapshot SNAPSHOT_ID`. No webhook is required. Login configuration is stored in `~/.config/otter/config.json`.

`login --dev` and `backup --dev` use `config.dev.json`. The login page changes to `otter.dev.hexly.ai`, while `OTTER_API_URL` still determines the upload target, defaulting to the production Worker. Both modes share local snapshot and icon directories. See [addresses and login configuration](10-development.md#地址与登录配置) for other deployments.

## Development

Install dependencies with Bun and use a Node.js version in the range above. A full build includes the CLI, API library and web interface:

```bash
git clone https://github.com/nocoo/otter.git
cd otter
bun install --frozen-lockfile
bun run --cwd packages/core build
bun run --cwd apps/cli build
bun run --cwd packages/api build
bun run build
```

The root `build` command builds only the web SPA. Inspect the compiled CLI with `node apps/cli/dist/bin.js --help`.

`bun run dev` starts Vite on port 7019. Its default `/api` proxy points to the production service at `https://otter.worker.hexly.ai`. Set `OTTER_API_URL` and the required `OTTER_DEV_API_TOKEN` in `apps/web/.env` before starting; API operations affect that target. This Vite configuration does not use the root `.env` as its environment file. See [local development](10-development.md#本地联调) for a local D1/R2 backend.

```text
apps/web/          Vite / React pages
apps/api/          Single Worker entry, D1 migrations and R2 bindings
apps/cli/          macOS collectors, CLI and local snapshots
apps/macos/        Native SwiftUI / AppKit Agent Workspace (XcodeGen)
packages/core/     Shared types
packages/api/      Hono app factory, authentication and data access library
```

Emit core declarations with `bunx tsc -p packages/core` before `bun run typecheck`; `bun run lint:biome` checks code style. Release deploys the production Worker after successful CI on main. It neither applies D1 migrations nor publishes the npm CLI. For 3.0, apply `0005_snapshot_v2.sql` first, deploy the API/Web with v1/v2 support, then distribute CLI/Mac clients; see [deployment](10-development.md#部署).

`bun run deploy:check` builds the Web SPA and runs a Wrangler deployment dry run. `apps/api/wrangler.toml` serves the output from `../web/dist`, so the Web UI and API continue to ship as one Worker. The release check verifies the API version, JavaScript, CSS and SPA deep links.

The native Agent Workspace scans harness configuration and Workflow relationships, edits complete Skill packages with reviewable changes and recovery, and runs backup tasks through its bundled CLI. With full Xcode, XcodeGen and Bun installed, run `bun run macos:build` and open `build/macos/Build/Products/Release/Otter.app`. The built app runs without Node or Bun. Its independent `macOS` workflow tests real native input and the packaged CLI, then verifies an unsigned universal app archive. See [macOS development](../apps/macos/README.md) and the [implementation record](features/03-macos-agent-workspace-implementation.md) for verified scope and remaining release checks.

## Tests

Run from the repository root:

| Scope | Command |
| --- | --- |
| Unit tests | `bun run test` |
| Unit tests with coverage reports | `bun run test:coverage` |
| Worker unit tests (Cloudflare runtime) | `bun run test:worker` |
| Local HTTP API and CLI integration | `bun run test:l2` |
| Browser tests with a local Worker | `bun run test:e2e` |
| Vite home-page title smoke | `bun run test:e2e:bdd` |
| Web build and Worker deployment dry run | `bun run deploy:check` |
| Running site's version, assets and SPA routing | `bun run verify:web <URL>` |
| Native macOS app build | `bun run macos:build` |
| Native core and actual app integration | `bun run macos:test` |
| Universal macOS package and relocation checks | `bun run macos:package` |

HTTP and CLI integration require the core, cli, api and web builds above. The runner starts local Wrangler on port 17020, resets its separate `.wrangler/e2e` state and applies migrations.

Browser tests require Chromium; install it with `bunx playwright install chromium`. `test:e2e` builds the SPA and uses port 27019 with separate `.wrangler/state-e2e-spa` storage. `test:e2e:bdd` starts Vite, whose proxy configuration determines the backend. Both browser commands use the same port and may reuse an existing server outside CI. Free the port first and see [test setup](10-development.md#测试入口) for a local backend.

## Stack

![TypeScript](https://img.shields.io/badge/TypeScript-3178C6?logo=typescript&logoColor=white)
![Node.js](https://img.shields.io/badge/Node.js-339933?logo=nodedotjs&logoColor=white)
![Bun](https://img.shields.io/badge/Bun-14151A?logo=bun&logoColor=white)
![React](https://img.shields.io/badge/React-20232A?logo=react&logoColor=61DAFB)
![Vite](https://img.shields.io/badge/Vite-646CFF?logo=vite&logoColor=white)
![Cloudflare Workers](https://img.shields.io/badge/Cloudflare_Workers-F38020?logo=cloudflareworkers&logoColor=white)

| Area | Implementation |
| --- | --- |
| CLI and collection | TypeScript, Node.js, @nocoo/base-cli |
| Dependencies and builds | Bun workspaces, TypeScript, Vite |
| Web | React, React Router, SWR, Tailwind CSS, Radix UI, Shiki |
| API and storage | Hono, Cloudflare Workers, D1, R2 |
| Authentication | Cloudflare Access, jose, Bearer token verification through D1 |
| Verification | Vitest, Playwright, Biome |

## Documentation

- [Documentation index](README.md)
- [Current development, collection scope and deployment](10-development.md)
- [3.0 configuration backup design and acceptance record](features/04-configuration-backup-redesign.md)
- [Collector design](02-collectors.md)
- [Hermes collector](features/01-hermes-collector.md)
- [Snapshot detail design](features/02-snapshot-detail-redesign.md)

## License

[MIT](../LICENSE) © 2026 Zheng Li
