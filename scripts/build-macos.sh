#!/usr/bin/env bash
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
MACOS_DIR="$REPO_ROOT/apps/macos"
OTTER_CONFIGURATION="${1:-Release}"
OTTER_ACTION="${2:-build}"
case "$OTTER_CONFIGURATION" in Debug|Release|generate) ;; *) printf 'Use Debug, Release or generate\n' >&2; exit 2 ;; esac
case "$OTTER_ACTION" in build|test) ;; *) printf 'Use build or test\n' >&2; exit 2 ;; esac

if [ -z "${DEVELOPER_DIR:-}" ] && [ -d /Applications/Xcode.app/Contents/Developer ]; then
  export DEVELOPER_DIR=/Applications/Xcode.app/Contents/Developer
fi

xcodegen generate --spec "$MACOS_DIR/project.yml" --project "$MACOS_DIR"
OTTER_RESOLVED="$MACOS_DIR/Otter.xcodeproj/project.xcworkspace/xcshareddata/swiftpm"
mkdir -p "$OTTER_RESOLVED"
cp "$MACOS_DIR/Package.resolved" "$OTTER_RESOLVED/Package.resolved"
if [ "$OTTER_CONFIGURATION" = generate ]; then exit 0; fi
OTTER_TEST_SETTINGS=()
if [ "$OTTER_ACTION" = test ]; then
  OTTER_TEST_SETTINGS=(-test-timeouts-enabled YES -default-test-execution-time-allowance 60 -maximum-test-execution-time-allowance 60)
fi
if [ "$OTTER_ACTION" = test ] || [ "$OTTER_CONFIGURATION" = Debug ]; then
  OTTER_DESTINATION="platform=macOS,arch=$(uname -m)"
  OTTER_ARCH_SETTINGS=(ONLY_ACTIVE_ARCH=YES)
else
  OTTER_DESTINATION="generic/platform=macOS"
  OTTER_ARCH_SETTINGS=("ARCHS=arm64 x86_64" ONLY_ACTIVE_ARCH=NO)
fi
xcodebuild -quiet \
  -project "$MACOS_DIR/Otter.xcodeproj" \
  -scheme Otter \
  -configuration "$OTTER_CONFIGURATION" \
  -destination "$OTTER_DESTINATION" \
  -derivedDataPath "$REPO_ROOT/build/macos" \
  -clonedSourcePackagesDirPath "$REPO_ROOT/build/macos-packages" \
  -disableAutomaticPackageResolution \
  -onlyUsePackageVersionsFromResolvedFile \
  "${OTTER_ARCH_SETTINGS[@]}" \
  ${OTTER_TEST_SETTINGS[@]+"${OTTER_TEST_SETTINGS[@]}"} \
  CODE_SIGNING_ALLOWED=NO \
  "$OTTER_ACTION"
