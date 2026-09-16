#!/bin/bash
# Standalone design host, adapted from Lyre. No production target or dependencies.
set -euo pipefail

study_dir="$(cd "$(dirname "$0")" && pwd)"
repo_dir="$(cd "$study_dir/../../.." && pwd)"
build_dir="$(mktemp -d -t otter-design)"
trap 'rm -rf "$build_dir"' EXIT
app_dir="$build_dir/Otter Design Study.app"
study_id="ai.hexly.otter.design.$(uuidgen | tr '[:upper:]' '[:lower:]')"
mkdir -p "$app_dir/Contents/MacOS" "$app_dir/Contents/Resources"
cp "$repo_dir/assets/brand/icon-rounded.png" "$app_dir/Contents/Resources/OtterIcon.png"
cat > "$app_dir/Contents/Info.plist" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
<key>CFBundleIdentifier</key><string>$study_id</string>
<key>CFBundleName</key><string>Otter Design Study</string>
<key>CFBundleExecutable</key><string>OtterDesignStudy</string>
<key>CFBundlePackageType</key><string>APPL</string>
<key>CFBundleShortVersionString</key><string>0.0.0</string>
<key>CFBundleVersion</key><string>1</string>
<key>NSHighResolutionCapable</key><true/>
<key>NSPrincipalClass</key><string>NSApplication</string>
<key>LSMinimumSystemVersion</key><string>15.0</string>
</dict></plist>
PLIST

export DEVELOPER_DIR="${DEVELOPER_DIR:-/Applications/Xcode.app/Contents/Developer}"
xcrun swiftc -parse-as-library -swift-version 6 -O \
    -target "$(uname -m)-apple-macos15.0" \
    -module-cache-path "$build_dir/module-cache" \
    "$study_dir/Controls.swift" "$study_dir/Workspace.swift" \
    "$study_dir/EditorAndSheets.swift" "$study_dir/Preview.swift" \
    -o "$app_dir/Contents/MacOS/OtterDesignStudy"

if [[ "${1:-}" == "--interactive" ]]; then
    "$app_dir/Contents/MacOS/OtterDesignStudy"
else
    output_dir="${1:-$study_dir/screenshots}"
    "$app_dir/Contents/MacOS/OtterDesignStudy" --render "$output_dir"
fi
