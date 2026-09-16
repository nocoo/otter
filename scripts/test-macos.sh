#!/usr/bin/env bash
set -euo pipefail
OTTER_REPO="$(cd "$(dirname "$0")/.." && pwd)"
cd "$OTTER_REPO"
bash scripts/build-macos.sh Debug test
python3 scripts/test-macos-ui.py "$@"
