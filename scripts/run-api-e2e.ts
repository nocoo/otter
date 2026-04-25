#!/usr/bin/env bun
/**
 * L2 API E2E runner — 真 HTTP, 真 CF 远端 D1/R2.
 *
 * Boots `wrangler dev --env test --remote --port 17020`, which proxies the
 * worker to Cloudflare so /api/* hits the real `otter-db-test` D1 and
 * `otter-snapshots-test` R2. Vitest globalSetup awaits this script.
 *
 * Hard gate: missing CF_ACCOUNT_ID / CF_D1_TEST_DATABASE_ID /
 * CF_D1_API_TOKEN / CF_API_TOKEN aborts before spawning anything.
 * `verifyTestDatabase()` then queries _test_marker so we never hit prod
 * D1 even if env values are mis-pasted.
 *
 * Implementation note: uses node:child_process (not bun.spawn) so vitest's
 * globalSetup — which runs under vite-node/Node, not Bun runtime — can
 * import this file.
 */

import { type ChildProcessWithoutNullStreams, spawn } from "node:child_process";
import { dirname, resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import { verifyTestDatabase } from "./verify-test-resources";

const PORT = Number(process.env.OTTER_L2_PORT ?? 17020);
const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const WORKER_DIR = resolve(REPO_ROOT, "packages/worker");
const HEALTH_TIMEOUT_MS = 90_000;

const REQUIRED_ENV = [
  "CF_ACCOUNT_ID",
  "CF_D1_TEST_DATABASE_ID",
  "CF_D1_API_TOKEN",
  "CF_API_TOKEN",
] as const;

let wrangler: ChildProcessWithoutNullStreams | null = null;

function log(msg: string): void {
  console.log(`[l2] ${msg}`);
}

function assertEnv(): void {
  const missing = REQUIRED_ENV.filter((k) => !process.env[k]);
  if (missing.length > 0) {
    throw new Error(
      `L2 env missing: ${missing.join(", ")}. Populate packages/web/.env or shell env.`,
    );
  }
}

async function waitForHealth(): Promise<void> {
  const url = `http://127.0.0.1:${PORT}/api/live`;
  const deadline = Date.now() + HEALTH_TIMEOUT_MS;
  let lastErr: unknown;
  while (Date.now() < deadline) {
    try {
      // biome-ignore lint/performance/noAwaitInLoops: poll loop
      const res = await fetch(url);
      if (res.status === 200) return;
      lastErr = `status=${res.status}`;
    } catch (err) {
      lastErr = err;
    }
    await delay(500);
  }
  throw new Error(`worker never became healthy on ${url}: ${String(lastErr)}`);
}

function startWrangler(): void {
  log(`spawning wrangler dev --env test --remote on :${PORT}`);
  wrangler = spawn(
    "bunx",
    [
      "wrangler",
      "dev",
      "--env",
      "test",
      "--remote",
      "--port",
      String(PORT),
      "--inspector-port",
      "0",
      "--ip",
      "127.0.0.1",
    ],
    {
      cwd: WORKER_DIR,
      env: {
        ...process.env,
        WRANGLER_LOG: "error",
        CLOUDFLARE_ACCOUNT_ID: process.env.CF_ACCOUNT_ID,
        CLOUDFLARE_API_TOKEN: process.env.CF_API_TOKEN,
      },
    },
  );
  wrangler.stdout.on("data", (buf: Buffer) => {
    process.stderr.write(`[wrangler] ${buf.toString()}`);
  });
  wrangler.stderr.on("data", (buf: Buffer) => {
    process.stderr.write(`[wrangler!] ${buf.toString()}`);
  });
}

export async function stopWrangler(): Promise<void> {
  if (!wrangler) return;
  log("stopping wrangler dev");
  const proc = wrangler;
  proc.kill("SIGTERM");
  const t = setTimeout(() => {
    if (proc.exitCode === null) proc.kill("SIGKILL");
  }, 5_000);
  await new Promise<void>((res) => {
    if (proc.exitCode !== null) {
      res();
      return;
    }
    proc.once("exit", () => res());
  });
  clearTimeout(t);
  wrangler = null;
}

export async function startApiE2eServer(): Promise<{ baseUrl: string; stop: () => Promise<void> }> {
  assertEnv();
  await verifyTestDatabase();
  startWrangler();
  await waitForHealth();
  const baseUrl = `http://127.0.0.1:${PORT}`;
  log(`ready on ${baseUrl}`);
  return { baseUrl, stop: stopWrangler };
}

const isMain = (() => {
  try {
    return fileURLToPath(import.meta.url) === process.argv[1];
  } catch {
    return false;
  }
})();

if (isMain) {
  const cleanup = async (): Promise<void> => {
    await stopWrangler();
    process.exit(process.exitCode ?? 0);
  };
  process.on("SIGINT", cleanup);
  process.on("SIGTERM", cleanup);
  await startApiE2eServer();
  if (wrangler) {
    await new Promise<void>((res) => wrangler?.once("exit", () => res()));
  }
}
