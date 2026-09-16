#!/usr/bin/env bash
# Single tsc --build pass over all TypeScript workspaces, leveraging incremental
# .tsbuildinfo caches: ~50ms warm vs ~700ms for the prior 4 parallel
# `tsc --noEmit` invocations.  Stops on first error.
set -uo pipefail
exec tsc -b packages/core apps/cli apps/web packages/api apps/api
