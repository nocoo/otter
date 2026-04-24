#!/usr/bin/env bash
# Run downstream tsc --noEmit checks in parallel, propagate failures.
set -uo pipefail

tsc --noEmit -p packages/cli/tsconfig.json &
P1=$!
tsc --noEmit -p packages/web/tsconfig.json &
P2=$!
tsc --noEmit -p packages/api/tsconfig.json &
P3=$!

FAIL=0
wait "$P1" || FAIL=1
wait "$P2" || FAIL=1
wait "$P3" || FAIL=1
exit "$FAIL"
