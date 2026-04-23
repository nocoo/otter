#!/usr/bin/env bun
/**
 * L3 Playwright E2E UI Test Runner
 *
 * 1. Free port
 * 2. Start Next.js web server (api is embedded via catch-all route)
 * 3. Run Playwright tests
 * 4. Cleanup
 */

import { type Subprocess, spawn } from "bun";
import { buildE2eEnv, cleanupBuildDir, ensurePortFree } from "./e2e-utils";

const E2E_UI_PORT = process.env.E2E_UI_PORT || "27019";
const E2E_DIST_DIR = "packages/web/.next-e2e-ui";

let serverProcess: Subprocess | null = null;

async function waitForServer(maxAttempts = 60): Promise<boolean> {
  const baseUrl = `http://localhost:${E2E_UI_PORT}`;
  for (let i = 0; i < maxAttempts; i++) {
    try {
      // biome-ignore lint/performance/noAwaitInLoops: retry loop with exponential backoff
      const response = await fetch(`${baseUrl}/login`);
      if (response.ok) return true;
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
  }
  return false;
}

async function dumpProc(proc: Subprocess | null, label: string) {
  if (!proc) return;
  const stdout =
    proc.stdout && typeof proc.stdout !== "number" ? await new Response(proc.stdout).text() : "";
  const stderr =
    proc.stderr && typeof proc.stderr !== "number" ? await new Response(proc.stderr).text() : "";
  if (stdout) console.error(`${label} stdout:\n`, stdout);
  if (stderr) console.error(`${label} stderr:\n`, stderr);
}

async function cleanup() {
  console.log("\n🧹 Cleaning up...");

  if (serverProcess) {
    serverProcess.kill();
    serverProcess = null;
  }
  await new Promise((resolve) => setTimeout(resolve, 500));

  cleanupBuildDir(E2E_DIST_DIR);
}

async function main() {
  console.log("🎭 L3 Playwright E2E UI Test Runner\n");

  await ensurePortFree(E2E_UI_PORT);

  const e2eEnv = await buildE2eEnv({ distDir: ".next-e2e-ui" });
  if (!e2eEnv) {
    console.log("⏭️  Skipping E2E UI — test resources not configured.");
    process.exit(0);
  }

  console.log("🌐 Starting E2E UI server on port", E2E_UI_PORT, "...");
  serverProcess = spawn(["bun", "run", "next", "dev", "-p", E2E_UI_PORT], {
    cwd: "packages/web",
    env: e2eEnv,
    stdout: "pipe",
    stderr: "pipe",
  });

  const ready = await waitForServer();
  if (!ready) {
    await dumpProc(serverProcess, "web");
    console.error("❌ Failed to start E2E UI server");
    await cleanup();
    process.exit(1);
  }
  console.log("✅ E2E UI server ready!\n");

  console.log("🎭 Running Playwright tests...\n");
  const testResult = Bun.spawnSync(
    [
      "bunx",
      "playwright",
      "test",
      "--config",
      "e2e/playwright.config.ts",
      ...process.argv.slice(2),
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

  await cleanup();

  console.log(
    "\n" +
      (testResult.exitCode === 0
        ? "✅ L3 Playwright E2E tests passed!"
        : "❌ L3 Playwright E2E tests failed!"),
  );
  process.exit(testResult.exitCode ?? 1);
}

process.on("SIGINT", async () => {
  await cleanup();
  process.exit(1);
});

process.on("SIGTERM", async () => {
  await cleanup();
  process.exit(1);
});

main();
