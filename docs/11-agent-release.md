# Agent release procedures

Detailed project constraints and procedures. The root [AGENTS.md](../AGENTS.md) defines the quality contract and records current enforcement gaps.

## Release Procedure

CLI package `@nocoo/otter` is published to npm. Use the automated release script:

```bash
bun run release              # patch bump (default)
bun run release -- minor     # minor bump
bun run release -- minor --macos # minor bump + verified macOS DMG/ZIP upload
bun run release -- major     # major bump
bun run release -- 2.1.0     # explicit version
bun run release -- 3.0.0 --prepared --macos # finalize an already prepared version
bun run release -- --dry-run # preview without side effects
```

The script handles:
1. Version bump in 9 files (all package.json + cli.ts + version.ts + macOS project.yml)
2. CHANGELOG generation from conventional commits
3. Build verification
4. Commit + tag + push + GitHub release

After release completes:
- **Worker deploy**: CD auto-triggers on CI green
- **npm publish** (manual): `cd apps/cli && npm publish` (requires `npm login` as `nocoo`)
- **Verify**: `npx @nocoo/otter@latest --help` in a temp directory

### Key decisions

- **Package name**: `@nocoo/otter` (personal scope, `otter-cli` was taken, `@otter` scope not owned)
- **`@otter/core` is NOT published**: Pure TypeScript types, all imports are `import type` — erased at compile time
- **npm publish is user-initiated only**: Never auto-publish. Only publish when explicitly requested
