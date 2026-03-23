#!/usr/bin/env bun
/**
 * L3 API E2E Test Runner
 *
 * This script:
 * 1. Ensures the target port is free
 * 2. Starts dev server on dedicated port with auth bypass
 * 3. Runs API-level E2E tests
 * 4. Cleans up
 */

import { type Subprocess, spawn } from "bun";
import { cleanupBuildDir, ensurePortFree } from "./e2e-utils";

const E2E_PORT = process.env.E2E_PORT || "17029";
const E2E_DIST_DIR = "packages/web/.next-e2e";

let serverProcess: Subprocess | null = null;

async function waitForServer(maxAttempts = 60): Promise<boolean> {
  const baseUrl = `http://localhost:${E2E_PORT}`;
  for (let i = 0; i < maxAttempts; i++) {
    try {
      const response = await fetch(`${baseUrl}/login`);
      if (response.ok) return true;
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
  }
  return false;
}

async function cleanup() {
  console.log("\n🧹 Cleaning up...");

  if (serverProcess) {
    serverProcess.kill();
    serverProcess = null;
    await new Promise((resolve) => setTimeout(resolve, 500));
  }

  cleanupBuildDir(E2E_DIST_DIR);
}

async function main() {
  console.log("🚀 L3 API E2E Test Runner\n");

  // Step 0: Ensure port is free
  await ensurePortFree(E2E_PORT);

  // Step 1: Start dev server
  console.log("🌐 Starting E2E server on port", E2E_PORT, "...");
  serverProcess = spawn(["bun", "run", "next", "dev", "-p", E2E_PORT], {
    cwd: "packages/web",
    env: {
      ...process.env,
      NEXT_DIST_DIR: ".next-e2e",
      E2E_SKIP_AUTH: "true",
    },
    stdout: "pipe",
    stderr: "pipe",
  });

  const ready = await waitForServer();
  if (!ready) {
    if (serverProcess) {
      const stdout =
        serverProcess.stdout && typeof serverProcess.stdout !== "number"
          ? await new Response(serverProcess.stdout).text()
          : "";
      const stderr =
        serverProcess.stderr && typeof serverProcess.stderr !== "number"
          ? await new Response(serverProcess.stderr).text()
          : "";
      if (stdout) console.error("Server stdout:\n", stdout);
      if (stderr) console.error("Server stderr:\n", stderr);
    }
    console.error("❌ Failed to start E2E server");
    await cleanup();
    process.exit(1);
  }
  console.log("✅ E2E server ready!\n");

  // Step 2: Run E2E tests
  console.log("🧪 Running L3 API E2E tests...\n");
  const testResult = Bun.spawnSync(
    ["bun", "test", "packages/web/src/__tests__/e2e", "--timeout", "30000"],
    {
      stdout: "inherit",
      stderr: "inherit",
      env: {
        ...process.env,
        E2E_PORT,
      },
    },
  );

  // Step 3: Cleanup
  await cleanup();

  console.log(
    "\n" +
      (testResult.exitCode === 0 ? "✅ L3 API E2E tests passed!" : "❌ L3 API E2E tests failed!"),
  );
  process.exit(testResult.exitCode ?? 1);
}

// Handle process signals
process.on("SIGINT", async () => {
  await cleanup();
  process.exit(1);
});

process.on("SIGTERM", async () => {
  await cleanup();
  process.exit(1);
});

main();
