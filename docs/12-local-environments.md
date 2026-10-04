# Local application environments

Shared plan: [system0-envs](../../../workflow/tasks/system0-envs/SKILL.md).
Reference architecture: Xray's native runtime, local gateway and fixed-instance client.

## Runtime contract

`bun run dev` serves the existing UI through a loopback gateway on 7019. Caddy already
maps `https://otter.dev.hexly.ai` to that port. The launcher injects a local capability
into HTML; neither build mode, hostname nor browser preferences grants it. A hosted
bundle has no capability or switching endpoint. Locally served built bundles use the
same gateway and control.

The upper-right action area begins with `Demo | E2E | Prod`, using Basalt 2.2.0
`SegmentControl` with keyboard navigation and selected/disabled states. Unsaved edits
use Basalt `ConfirmDialog`, not the browser-native confirmation prompt. Selection is accepted by the
server, checked against the current instance and CSRF/origin protections, remembered
as the enum in `otter:environment-mode`, then reloads `/`. Explicit startup wins over
browser preference; automated E2E always wins and never changes that preference.
Manual E2E is switchable, including explicit/remembered initial selection.

API URLs include a captured instance ID. Another tab's preference change cannot
retarget old requests. Expired instances return 409, and proxy requests capture the
original backend before awaiting their body. Cookies, Access headers and browser
Production credentials are not forwarded across modes. Fixture credentials remain
server-side. Pending writes and the Settings token draft require discard confirmation.

## Storage and authentication

- Demo persists in `apps/api/.wrangler/environments/demo`. Two synthetic machines,
  three v2 snapshots, complete/partial coverage, history, linked instructions,
  standalone skills, Hermes profiles and webhook tokens use normal APIs and storage.
  Existing edits survive restart; catalog changes require explicit reset.
- Each E2E gets a unique sibling state directory, D1 database ID, R2 store, identity,
  gateway/Worker ports and generated runtime configuration. Leaving manual E2E removes
  that owned state; reentry is fresh. Automated instances lock both UI and server.
- Workers use production compatibility date/flags and asset configuration read from
  `apps/api/wrangler.toml`, production migrations and the production entrypoint.
  Intentional differences: local-only D1/R2 bindings, test-suffixed names and
  `ENVIRONMENT=test`; no deployed routes or remote bindings.
- Local Bearer tokens are generated, hashed with the existing token implementation,
  inserted into local D1 with an expiry, verified normally and revoked on shutdown.
  There is no localhost or E2E authentication bypass.
- Cleanup stops the owned Worker, validates canonical path/owner metadata, verifies
  the D1 marker, then deletes only the owned temporary state. Demo has an exclusive
  active lock. A foreign path, symlink, altered config or marker fails visibly.
- Prod has a fixed `https://otter.worker.hexly.ai` target and uses a real
  `OTTER_DEV_API_TOKEN` from `apps/web/.env`. Missing credentials produce an explicit
  401 and leave Prod selected. No daily CLI credentials are read automatically.
  Production acceptance remains a separately authorized operation.

## Commands

Build core and Web before first local startup. Use the declared registry policy.

```bash
bun run --cwd packages/core build
bun run build
bun run dev
bun run dev -- --mode e2e
bun run dev -- --mode prod
bun run dev:built
bun run demo:reset
bun run test:l2
bun run test:e2e
bun run test:e2e:bdd
bun scripts/verify-environments.ts
bun scripts/verify-basalt.ts
```

Stop the dev launcher before resetting Demo. The two browser suites share gateway
27019, run serially, never reuse existing servers and wait for graceful cleanup.
L2 dynamically allocates its gateway and Worker ports. All automated launchers refuse
inherited production credentials and skip reading `.env`/daily `.dev.vars`; their
child processes receive an explicit environment allowlist. The old Vite production
proxy and fixed persistence deletion were removed. Legacy HTTP D1 access is rejected
in automated local child runtimes.

## Feature-to-fixture matrix

Fixture version 1 uses synthetic source `scripts/fixtures/snapshot-v2.json` and a
fixed capture anchor `2026-09-17T00:00:00.000Z`. No production dump, private files or
external app-image assets were copied. Standard product icons require no fixture
media. Presentation relative time is not frozen; receipt timestamps reflect seeding.

| Feature / route | Fixture / scenario | API / action | Evidence |
|---|---|---|---|
| Machines `/` | Studio partial + complete history; Travel complete | List, search, browse | Demo screenshot reviewed; browser suite |
| Device `/devices/:id` | Workflow source, Claude and Hermes profiles | Browse profile/resources | Existing real-storage recovery E2E |
| Snapshots `/snapshots` | Three coherent capture dates | Search, paging, open | Existing browser suite; full Demo paging inventory unverified |
| Detail `/snapshots/:id` | Complete source instructions, linked instructions, skill script, persona | View file, download package/recovery ZIP | Existing real-storage recovery E2E |
| Compare `/compare` | Studio complete → partial | Compare coverage and history | Existing recovery E2E; richer file-change Demo scenario pending |
| Settings `/settings` | Fixture account and two webhook tokens | Create, toggle, delete | Real CRUD isolation check; existing UI suite also has intercepted cases |
| CLI `/cli/connect` | Verified fixture identity and normal token issuer | Loopback token issuance | L2 real HTTP flow; full browser pairing unverified |
| Failures | Missing/bad token, expired instance, unavailable Prod auth, rejected cleanup | 401/403/409 and guarded deletion | Focused native environment acceptance |
| Environment control | Demo/manual E2E/Prod auth-required, automated/hosted | Switch, discard/cancel, fresh reentry | Browser and server acceptance; real Prod not exercised |

## Verified evidence and remaining gaps

Local implementation checks: L2 16 tests; Worker 21 tests; SPA browser 29 tests;
BDD smoke 1 test; full unit suite 755 tests. Coverage S/B/F/L:
97.02/94.38/96.39/97.69% against the existing configured scope. Branches remain below
the handbook's all-four 95% destination; thresholds/exclusions were not weakened.

`verify-environments.ts` exercises real native storage and browser switching,
leftmost control placement, draft cancel/accept, stale-instance 409, E2E fresh reentry,
missing Production credential 401, server-side automated lock, hosted invisibility,
concurrent identity/data isolation, foreign ownership rejection and checked cleanup.
It replaces only the external font CSS boundary for reproducible browser checks.
Screenshots: `/tmp/otter-environments-demo.png`, `/tmp/otter-environments-demo-dark.png`,
`/tmp/otter-environments-mobile-dark.png` and `/tmp/otter-environments-confirm.png`.
Desktop 1440×1000 and mobile 390×844; local fixture v1. Basalt segment selection,
normal theme cycling, mobile overflow, dialog focus and cancel/accept were exercised.

The complete Web migration uses published Basalt 2.2.0, verified through the permitted
registry, installed artifact, declarations and AI guides. GitHub's latest Release was
still 2.1.8 at lookup; it was not used to deny the newer registry artifact. The old
copied controls, shell, chart palette and unprefixed color system were removed.
See [Basalt workspace design](13-basalt-workspace.md) for hierarchy, identity and
visual acceptance. `verify-basalt.ts` creates disposable rich E2E data and captures
all eight routes in both themes at 1440×1000 and 390×844, plus panels/viewers/navigation.
It exercises local code with external images replaced at the media boundary.

Real Prod data/auth/Access/MFA were not verified. Existing browser UI interception
suites remain for focused view cases and are not claimed as full HTTP proof. Full
feature/media/error inventory, all-four 95% coverage, native desktop parity and
exhaustive cleanup race validation remain gaps. No release, push or deployment is
part of this implementation.
