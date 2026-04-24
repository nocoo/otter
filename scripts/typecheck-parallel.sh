#!/usr/bin/env bash
# Single tsc --build pass over all 4 packages, leveraging incremental
# .tsbuildinfo caches: ~50ms warm vs ~700ms for the prior 4 parallel
# `tsc --noEmit` invocations.  Stops on first error.
set -uo pipefail
exec tsc -b packages/core packages/cli packages/web packages/api
