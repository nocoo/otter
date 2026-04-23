#!/usr/bin/env bun
/**
 * L2 API E2E Test Runner
 *
 * 1. Free both ports
 * 2. Start the api Hono server (Bun watch) on E2E_API_PORT
 * 3. Start Next.js web server on E2E_PORT (rewrites /api/* to api)
 * 4. Run E2E tests against the web port
 * 5. Cleanup
 */

import { type Subprocess, spawn } from "bun";
import { buildE2eEnv, cleanupBuildDir, ensurePortFree } from "./e2e-utils";

const E2E_PORT = process.env.E2E_PORT || "17019";
const E2E_API_PORT = process.env.E2E_API_PORT || "17020";
const E2E_DIST_DIR = "packages/web/.next-e2e";

let webProcess: Subprocess | null = null;
let apiProcess: Subprocess | null = null;

async function waitForUrl(url: string, expectOk: boolean, maxAttempts = 60): Promise<boolean> {
  for (let i = 0; i < maxAttempts; i++) {
    try {
      // biome-ignore lint/performance/noAwaitInLoops: retry loop
      const response = await fetch(url);
      if (expectOk ? response.ok : response.status > 0) return true;
    } catch {
      // ignore
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
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

  if (webProcess) {
    webProcess.kill();
    webProcess = null;
  }
  if (apiProcess) {
    apiProcess.kill();
    apiProcess = null;
  }
  await new Promise((resolve) => setTimeout(resolve, 500));

  cleanupBuildDir(E2E_DIST_DIR);
}

async function main() {
  console.log("🚀 L2 API E2E Test Runner\n");

  await ensurePortFree(E2E_PORT);
  await ensurePortFree(E2E_API_PORT);

  const e2eEnv = await buildE2eEnv({ distDir: ".next-e2e" });
  if (!e2eEnv) {
    console.log("⏭️  Skipping E2E — test resources not configured.");
    process.exit(0);
  }

  // Start api server first
  console.log("🌐 Starting api server on port", E2E_API_PORT, "...");
  apiProcess = spawn(["bun", "run", "src/server.ts"], {
    cwd: "packages/api",
    env: { ...e2eEnv, PORT: E2E_API_PORT },
    stdout: "pipe",
    stderr: "pipe",
  });

  const apiReady = await waitForUrl(`http://localhost:${E2E_API_PORT}/v1/live`, false);
  if (!apiReady) {
    await dumpProc(apiProcess, "api");
    console.error("❌ Failed to start api server");
    await cleanup();
    process.exit(1);
  }
  console.log("✅ api server ready");

  // Start web with rewrites pointed at api
  console.log("🌐 Starting web server on port", E2E_PORT, "...");
  webProcess = spawn(["bun", "run", "next", "dev", "-p", E2E_PORT], {
    cwd: "packages/web",
    env: { ...e2eEnv, API_INTERNAL_URL: `http://localhost:${E2E_API_PORT}` },
    stdout: "pipe",
    stderr: "pipe",
  });

  const webReady = await waitForUrl(`http://localhost:${E2E_PORT}/login`, true);
  if (!webReady) {
    await dumpProc(webProcess, "web");
    await dumpProc(apiProcess, "api");
    console.error("❌ Failed to start web server");
    await cleanup();
    process.exit(1);
  }
  console.log("✅ web server ready!\n");

  console.log("🧪 Running L2 API E2E tests...\n");
  const testResult = Bun.spawnSync(
    ["bun", "test", "packages/api/src/__tests__/e2e", "--timeout", "30000"],
    {
      stdout: "inherit",
      stderr: "inherit",
      env: {
        ...process.env,
        E2E_PORT,
        WORKER_API_URL: "https://otter-test.nocoo.workers.dev",
      },
    },
  );

  await cleanup();

  console.log(
    "\n" +
      (testResult.exitCode === 0 ? "✅ L2 API E2E tests passed!" : "❌ L2 API E2E tests failed!"),
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
