#!/usr/bin/env bash
# Parallel typecheck: core + api + web in parallel; cli waits for core (only one
# that imports @otter/core types). Propagates failures.
set -uo pipefail

tsc -p packages/core/tsconfig.json &
PCORE=$!
tsc --noEmit -p packages/api/tsconfig.json &
PAPI=$!
tsc --noEmit -p packages/web/tsconfig.json &
PWEB=$!

FAIL=0
wait "$PCORE" || FAIL=1

# cli depends on core's emitted .d.ts; only start after core is done
tsc --noEmit -p packages/cli/tsconfig.json &
PCLI=$!

wait "$PAPI" || FAIL=1
wait "$PWEB" || FAIL=1
wait "$PCLI" || FAIL=1

exit "$FAIL"
