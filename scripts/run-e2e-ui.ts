#!/usr/bin/env bun
/**
 * L3 Playwright E2E UI Test Runner
 *
 * This script:
 * 1. Ensures the target port is free
 * 2. Starts dev server on dedicated port with auth bypass
 * 3. Runs Playwright tests
 * 4. Cleans up
 */

import { type Subprocess, spawn } from "bun";
import { buildE2eEnv, cleanupBuildDir, ensurePortFree } from "./e2e-utils";

const E2E_UI_PORT = process.env.E2E_UI_PORT || "27029";
const E2E_DIST_DIR = "packages/web/.next-e2e-ui";

let serverProcess: Subprocess | null = null;

async function waitForServer(maxAttempts = 60): Promise<boolean> {
  const baseUrl = `http://localhost:${E2E_UI_PORT}`;
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
  console.log("🎭 L3 Playwright E2E UI Test Runner\n");

  // Step 0: Ensure port is free
  await ensurePortFree(E2E_UI_PORT);

  // Step 1: Build isolated test env (D1/R2 overrides + _test_marker verification)
  const e2eEnv = await buildE2eEnv({ distDir: ".next-e2e-ui" });
  if (!e2eEnv) {
    console.log("⏭️  Skipping E2E UI — test resources not configured.");
    process.exit(0);
  }

  // Step 2: Start dev server with test resources
  console.log("🌐 Starting E2E UI server on port", E2E_UI_PORT, "...");
  serverProcess = spawn(["bun", "run", "next", "dev", "-p", E2E_UI_PORT], {
    cwd: "packages/web",
    env: e2eEnv,
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
    console.error("❌ Failed to start E2E UI server");
    await cleanup();
    process.exit(1);
  }
  console.log("✅ E2E UI server ready!\n");

  // Step 3: Run Playwright tests
  console.log("🎭 Running Playwright tests...\n");
  const testResult = Bun.spawnSync(
    [
      "bunx",
      "playwright",
      "test",
      "--config",
      "e2e/playwright.config.ts",
      ...process.argv.slice(2), // pass through CLI args (e.g. --headed, --grep)
    ],
    {
      cwd: "packages/web",
      stdout: "inherit",
      stderr: "inherit",
      env: {
        ...process.env,
        E2E_UI_PORT,
      },
    },
  );

  // Step 4: Cleanup
  await cleanup();

  console.log(
    "\n" +
      (testResult.exitCode === 0
        ? "✅ L3 Playwright E2E tests passed!"
        : "❌ L3 Playwright E2E tests failed!"),
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
