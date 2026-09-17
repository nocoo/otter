#!/usr/bin/env bash
set -euo pipefail
OTTER_REPO="$(cd "$(dirname "$0")/.." && pwd)"
OTTER_OUTPUT="${1:-$OTTER_REPO/build/macos-cli}"
OTTER_CACHE="$OTTER_REPO/build/macos-cli"
export PATH="/opt/homebrew/bin:/usr/local/bin:$PATH"
mkdir -p "$OTTER_CACHE" "$OTTER_OUTPUT"
OTTER_OUTPUT="$(cd "$OTTER_OUTPUT" && pwd)"
cd "$OTTER_REPO"
# Cache the source/dependency archive and Bun version. Never lipo compiled Bun payloads.
OTTER_FINGERPRINT="$(tar -cf - apps/cli/src apps/cli/package.json packages/core/src packages/core/package.json bun.lock scripts/build-macos-cli.sh | shasum -a 256 | cut -d ' ' -f 1)-$(bun --version)"
# Bun can leave temporary .bun-build files; keep them with other build artifacts.
cd "$OTTER_CACHE"
for OTTER_ARCH in arm64 x64; do
  OTTER_HELPER="$OTTER_CACHE/otter-$OTTER_ARCH"
  if [ ! -x "$OTTER_HELPER" ] || [ "$(cat "$OTTER_HELPER.sha256" 2>/dev/null || true)" != "$OTTER_FINGERPRINT" ] || ! codesign --verify --strict "$OTTER_HELPER" >/dev/null 2>&1; then
    OTTER_STAGED_HELPER="$OTTER_CACHE/otter-$OTTER_ARCH.$$.staged"
    trap 'rm -f "$OTTER_STAGED_HELPER"' EXIT
    bun build "$OTTER_REPO/apps/cli/src/bin.ts" --compile --target="bun-darwin-$OTTER_ARCH" --outfile "$OTTER_STAGED_HELPER" >&2
    codesign --force --sign - "$OTTER_STAGED_HELPER"
    codesign --verify --strict "$OTTER_STAGED_HELPER"
    mv -f "$OTTER_STAGED_HELPER" "$OTTER_HELPER"
    printf '%s' "$OTTER_FINGERPRINT" > "$OTTER_HELPER.sha256"
  fi
  if [ "$OTTER_CACHE" != "$OTTER_OUTPUT" ]; then
    # Replacing the inode also avoids macOS retaining signature state from an older helper.
    cp "$OTTER_HELPER" "$OTTER_OUTPUT/otter-$OTTER_ARCH.$$.staged"
    mv -f "$OTTER_OUTPUT/otter-$OTTER_ARCH.$$.staged" "$OTTER_OUTPUT/otter-$OTTER_ARCH"
  fi
done
