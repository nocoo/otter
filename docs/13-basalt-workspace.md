# Basalt Web workspace

## Scope and authority

The Web UI uses `@nocoo/basalt` **2.2.0**, verified from the allowed npm mirror and
installed artifact. The current upstream guide was read at Basalt revision
`ac93bca576adc13f4af383250a5a068a0538756d`; package AI guides, exports, declarations
and source maps bound the APIs actually used. Shared design procedure:
`system0-design-basalt` 1.0.0. The macOS AppKit application is outside this Web change.

All eight routes keep their URLs, API queries, account identity, filtering and saved
snapshot bytes. No database migration, seed reset, production write or release is
part of the UI migration. Settings now maps the actual snake_case webhook response
into its view state; this fixes an existing mock/API mismatch without changing rows.

## Hierarchy

- `ThemeProvider` → `AccentProvider` (existing teal identity) → `TooltipProvider`,
  React Router `LinkProvider`, one Toaster.
- Responsive `AppShell` owns safe areas and scroll geometry. Desktop Sidebar remains
  in flow; mobile uses the same navigation in Basalt Sheet with focus restoration.
- Sidebar owns accepted product logo, build-derived version, Recovery/Workspace
  navigation groups, current account and logout. Router links retain native browser
  modifier-click semantics. Logo left position stays fixed during collapse.
- `AppMain` → `AppHeader` (real ancestor destinations, current route, local segmented
  control first, GitHub/hexly links, theme last) → one `ContentIsland` L1 root.
- Every route starts with PageHeader. SectionRule groups product regions; LayerCard
  Header/Body/Footer stays L2, Well provides L3. No copied color-token system remains.
- Basalt controls handle forms, choices, tables, badges, tabs, alerts, collapsibles,
  dialogs, sheets and disabled/loading states. No raw button/input/select/table or
  native details/summary remains in application UI source.
- Legacy overview charts use package DonutChart/BarChart and normal numeric data
  alternatives. The five machine metrics compose LayerCard because the published
  StatCard's fixed surfaces do not follow the inspected nested-surface contract.

## Routes

| Route | Composition and preserved interaction |
|---|---|
| `/` | Machine cards, coverage/receipt distinction, search, complete-backup links and CLI guidance |
| `/devices/:deviceId` | Machine history actions and source/profile/resource coverage |
| `/snapshots` | Real cursor paging/search, chronological comparison selection, same totals and metadata |
| `/snapshots/:id` | V2 workspace panels; legacy collector inventory and charts; JSON/recovery exports |
| `/compare` | Scope/incomplete warning, file permission/link/content diffs and environment diffs |
| `/settings` | Account, normal real webhook create/toggle/delete/copy, disabled bulk deletion |
| `/cli/connect` | Same validated loopback callback and authenticated token issuance |
| unmatched route | 404 state and Dashboard destination |

Two viewers use explicit `Dialog size="xl"`, visible named close buttons, focus
traps and bounded scrolling. The file viewer retains Shiki syntax spans as a
specialist renderer inside Basalt controls and surfaces; displayed content is not
rewritten. Recovery ZIPs retain bytes, permissions and link metadata.

## Public account avatar

Gecko was inspected for SidebarUser/Avatar composition. Its checked-out implementation
used login-provided images, not a lizheng.blog client. Firefly's public author-profile
source and live empty-query headers established the actual endpoint and lack of CORS.

The sidebar requests `/api/profile` through the normal authenticated API. The Worker
uses only `accessEmail`, normalizes and SHA-256 hashes it, then queries the fixed
`https://lizheng.blog/api/authors/profile?hash=...` service without forwarding cookies,
tokens or browser-selected endpoints. Redirects are rejected. Only a valid HTTPS
avatar URL is returned; external name never replaces the authenticated account name.
The response is no-store and the UI cache key includes account email. Local fixture
identities never call the service. Missing image/profile/network error retains the
Basalt initials fallback. Real-owner avatar visibility remains an explicit Prod check.

## Evidence

- Independent Codex source review found and verified fixes for viewer width/close,
  collapsed logout, navigation semantics, identity-bound cache and breadcrumbs;
  source-level sign-off obtained. Task-owned helper panes were closed.
- Frozen install, project typecheck, check-only Biome with errors-on-warnings, build,
  755 unit tests/coverage, 21 Worker tests, 16 L2 HTTP/CLI tests, 33 browser tests and
  BDD smoke passed. Four coverage S/B/F/L: 97.02/94.38/96.39/97.69; the existing 94%
  branch gate passes, but handbook all-four 95% attainment remains incomplete.
- Environment acceptance retains Demo/manual E2E/Prod-auth-required switching,
  automated locks, hosted invisibility, stale-request rejection and owned cleanup.
- `bun scripts/verify-basalt.ts` captured 51 scenarios with local native storage:
  eight routes × two themes × desktop/mobile, legacy/workspace panels, single-file
  and skill-package viewers in all four theme/viewport combinations, both viewers,
  collapsed rail and mobile navigation. It rejects page errors and horizontal
  overflow, checks viewer width, stable logo placement, route URLs and modal focus.
  Evidence: ignored `test-results/basalt-acceptance/manifest.json` and PNGs.
- Reviewed screenshots include machine/device cards, settings with actual active
  tokens and valid timestamps, resource/file viewers, charts, snapshot table,
  comparison warning and CLI pairing. Real local webhook CRUD has a browser
  regression so camelCase mocks cannot hide state/date errors again.

## Typography and spacing refinement

Resource/file viewers and the token dialog use a compact 16px title, 14px body/card
heading and 12px metadata/code scale. Resource header, actions and content have an
explicit 16px layout gap. Preview content has one 12px Well inset, not stacked
Body/Well padding. Mobile file choices retain 44px minimum touch height. Paths wrap
independently of relationship labels. Four real-storage browser cases assert the
rendered type scale, spacing, preview inset, non-overflow and file selection.

Physical iPhone safe-area/software-keyboard behavior, real avatar/provider/Access
login, exhaustive visual contrast and native desktop design remain unverified.
No push, deploy, release or npm publication occurred.
