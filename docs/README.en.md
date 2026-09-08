<p align="center">
  <img src="../assets/brand/icon-rounded.png" alt="Otter" width="128" height="128" />
</p>

<h1 align="center">Otter</h1>

<p align="center">Save macOS development settings and inventories, and inspect snapshots over time.</p>

<p align="center">
  <a href="https://otter.hexly.ai">Website</a> ·
  <a href="../README.md">简体中文</a>
</p>

## What it does

Otter collects development settings, applications and environment inventories on macOS, then saves them as local or cloud JSON snapshots for moving computers and investigating environment changes. The web interface provides snapshot overviews, file inspection and JSON export. Restoring files and reinstalling software are manual steps.

A single Cloudflare Worker serves the API and web interface. D1 holds users, tokens and snapshot indexes; R2 stores snapshot bodies and application icons. Snapshot lists and details are scoped to the signed-in email address.

## Features

- Collect Claude Code, OpenCode and shell settings, plus inventories for Homebrew, applications, VS Code extensions, Docker, fonts, development tools, cloud CLIs, macOS preferences and LaunchAgents.
- Collect settings, memories, user profiles, scheduled tasks and skill names from the main Hermes profile and named profiles.
- Save snapshots locally or sign in to upload compressed snapshots. Successful uploads create a local copy, followed by a separate attempt to export and upload application icons.
- List, inspect and compare local snapshots in the CLI. Comparison tracks added or removed files, file sizes and inventory names; it cannot detect content changes in files of the same size.
- Browse paginated snapshots, inspect collector results and file contents, export JSON, and manage webhooks for legacy ingestion in the web interface.

`--slim` excludes only Claude prompt history and session summaries. Other settings, Hermes memories and user profiles are still collected. Credential redaction depends on file types and matching rules. For first use, save and inspect the local JSON before deciding whether to upload. See [collection and snapshot scope](10-development.md#采集与快照边界).

## Usage

### Installation and local snapshots

Use macOS and Node.js. The repository declares the Node.js range `^22.12.0 || ^24.0.0 || >=26.0.0`.

```bash
npm install -g @nocoo/otter
otter --help
otter scan --slim --save
otter snapshot list
```

Local snapshots live in `~/.config/otter/snapshots/`. Use a full ID or its first eight characters from the list to inspect or compare snapshots, replacing the example IDs with actual values:

```bash
otter snapshot show SNAPSHOT_ID
otter snapshot diff OLD_ID NEW_ID
```

### Cloud backups

The [website](https://otter.hexly.ai) requires an identity allowed by Cloudflare Access. Login opens a browser connection page and saves a token through a local callback:

```bash
otter login
otter backup --slim
```

`backup` scans again, sends the snapshot to `https://otter.worker.hexly.ai/api/snapshots` with a Bearer token, and then uploads icons. This flow does not require creating a webhook. Login configuration is stored in `~/.config/otter/config.json`.

`login --dev` and `backup --dev` use `config.dev.json`. The login page changes to `otter.dev.hexly.ai`, while `OTTER_API_URL` still determines the upload target, defaulting to the production Worker. Both modes share local snapshot and icon directories. See [addresses and login configuration](10-development.md#地址与登录配置) for other deployments.

## Development

Install dependencies with Bun and use a Node.js version in the range above. A full build includes the CLI, API library and web interface:

```bash
git clone https://github.com/nocoo/otter.git
cd otter
bun install --frozen-lockfile
bun run --cwd packages/core build
bun run --cwd packages/cli build
bun run --cwd packages/api build
bun run build
```

The root `build` command builds only the web SPA. Inspect the compiled CLI with `node packages/cli/dist/bin.js --help`.

`bun run dev` starts Vite on port 7019. Its default `/api` proxy points to the production service at `https://otter.nocoo.workers.dev`. Set `OTTER_API_URL` and the required `OTTER_DEV_API_TOKEN` in `packages/web/.env` before starting; API operations affect that target. This Vite configuration does not use the root `.env` as its environment file. See [local development](10-development.md#本地联调) for a local D1/R2 backend.

```text
packages/cli/       macOS collectors, CLI and local snapshots
packages/core/      Shared types
packages/api/       Hono app factory, authentication and data access library
packages/web/       Vite / React pages
packages/worker/    Single Worker entry, D1 migrations and R2 bindings
```

`bun run typecheck` checks types; `bun run lint:biome` checks code style. Release deploys the production Worker after successful CI on main. It neither applies D1 migrations nor publishes the npm CLI; see [deployment](10-development.md#部署).

## Tests

Run from the repository root:

| Scope | Command |
| --- | --- |
| Unit tests | `bun run test` |
| Unit tests with coverage reports | `bun run test:coverage` |
| Local HTTP API and CLI integration | `bun run test:l2` |
| Browser tests with a local Worker | `bun run test:e2e` |
| Vite home-page title smoke | `bun run test:e2e:bdd` |

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
- [Collector design](02-collectors.md)
- [Hermes collector](features/01-hermes-collector.md)
- [Snapshot detail design](features/02-snapshot-detail-redesign.md)

## License

[MIT](../LICENSE) © 2026 Zheng Li
