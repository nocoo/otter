/**
 * Shared E2E utilities for test runner scripts.
 */

import { existsSync, readFileSync, rmSync } from "node:fs";
import { resolve } from "node:path";
import { verifyTestDatabase } from "./verify-test-resources";

/**
 * Load packages/web/.env into process.env (without overriding existing vars).
 * Runner scripts execute from repo root, so Next.js auto-loading doesn't apply.
 */
function loadWebEnv(): void {
  const envPath = resolve("packages/web/.env");
  if (!existsSync(envPath)) return;

  const content = readFileSync(envPath, "utf-8");
  for (const line of content.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eqIdx = trimmed.indexOf("=");
    if (eqIdx === -1) continue;
    const key = trimmed.slice(0, eqIdx);
    const value = trimmed.slice(eqIdx + 1);
    // Don't override existing env vars (e.g. from shell)
    if (!(key in process.env)) {
      process.env[key] = value;
    }
  }
}

/**
 * Ensure a TCP port is free before starting a server.
 * If occupied, kills the occupying process and waits briefly.
 */
export async function ensurePortFree(port: string | number): Promise<void> {
  const proc = Bun.spawn(["lsof", "-ti", `:${port}`], {
    stdout: "pipe",
    stderr: "pipe",
  });

  const pids = (await new Response(proc.stdout).text()).trim();
  await proc.exited;

  if (!pids) return;

  const pidList = pids.split("\n").filter(Boolean);
  console.warn(`⚠️  Port ${port} occupied by PID ${pidList.join(", ")} — killing...`);

  for (const pid of pidList) {
    try {
      Bun.spawnSync(["kill", "-9", pid]);
    } catch {
      // Process may have already exited
    }
  }

  // Wait for port to be released
  await new Promise((resolve) => setTimeout(resolve, 500));
  console.log(`   Port ${port} is now free.`);
}

/**
 * Remove a build directory and log it.
 */
export function cleanupBuildDir(dir: string): void {
  if (existsSync(dir)) {
    rmSync(dir, { recursive: true, force: true });
    console.log(`   Removed ${dir}`);
  }
}

/**
 * Build an env object for the E2E dev server with test resource isolation.
 *
 * Performs the Variant B triple-check (existence → inequality → override):
 *  1. CF_D1_TEST_DATABASE_ID and CF_R2_TEST_BUCKET must be set
 *  2. They must differ from their production counterparts
 *  3. Overrides CF_D1_DATABASE_ID and CF_R2_BUCKET so the server uses test resources
 *
 * Also verifies the test database via _test_marker table.
 *
 * Returns null if test env vars are missing (caller should skip E2E gracefully).
 */
export async function buildE2eEnv(options: {
  distDir: string;
}): Promise<Record<string, string | undefined> | null> {
  // Load packages/web/.env since runner scripts execute from repo root
  loadWebEnv();

  const testDbId = process.env.CF_D1_TEST_DATABASE_ID;
  const prodDbId = process.env.CF_D1_DATABASE_ID;
  const testBucket = process.env.CF_R2_TEST_BUCKET;
  const prodBucket = process.env.CF_R2_BUCKET;

  // 1. Existence check — soft gate: warn + skip
  if (!testDbId || !testBucket) {
    console.warn("⚠️  CF_D1_TEST_DATABASE_ID or CF_R2_TEST_BUCKET not set — skipping E2E");
    return null;
  }

  // 2. Inequality check — prevent misconfiguration pointing back to prod
  if (testDbId === prodDbId) {
    throw new Error(
      "CF_D1_TEST_DATABASE_ID === CF_D1_DATABASE_ID. Refusing to run E2E against prod.",
    );
  }
  if (testBucket === prodBucket) {
    throw new Error("CF_R2_TEST_BUCKET === CF_R2_BUCKET. Refusing to run E2E against prod.");
  }

  // 3. Verify _test_marker in the test database
  await verifyTestDatabase();

  // 4. Build env with overrides
  return {
    ...process.env,
    CF_D1_DATABASE_ID: testDbId,
    CF_R2_BUCKET: testBucket,
    NEXT_DIST_DIR: options.distDir,
    E2E_SKIP_AUTH: "true",
    // Worker API for BFF routes
    WORKER_API_URL: "https://otter-api-test.nocoo.workers.dev",
    WORKER_API_KEY: "test-api-key-e2e",
  };
}
