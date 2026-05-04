#!/usr/bin/env bun
/**
 * L2 API E2E runner — local-only via wrangler dev --local --persist-to.
 *
 * Boots `wrangler dev --local --port 17020 --persist-to=.wrangler/e2e` which
 * uses miniflare to simulate D1/R2 locally. No remote CF resources needed.
 *
 * Steps:
 *   1. Clean persist dir (.wrangler/e2e) for full isolation.
 *   2. Apply all migrations from packages/worker/migrations/ (sorted).
 *   3. Seed a test user (dev@localhost auto-stamp handles auth).
 *   4. Start wrangler dev --local.
 *   5. Wait for /api/live to become healthy.
 *
 * Implementation note: uses node:child_process (not bun.spawn) so vitest's
 * globalSetup — which runs under vite-node/Node, not Bun runtime — can
 * import this file.
 */

import { type ChildProcessWithoutNullStreams, execSync, spawn } from "node:child_process";
import { existsSync, readdirSync, rmSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";

const PORT = Number(process.env.OTTER_L2_PORT ?? 17020);
const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const WORKER_DIR = resolve(REPO_ROOT, "packages/worker");
const MIGRATIONS_DIR = resolve(WORKER_DIR, "migrations");
const PERSIST_DIR = ".wrangler/e2e";
const PERSIST_ABS = resolve(WORKER_DIR, PERSIST_DIR);
const HEALTH_TIMEOUT_MS = 60_000;
const MIGRATION_FILE_RE = /^\d{4}.*\.sql$/;

let wrangler: ChildProcessWithoutNullStreams | null = null;

function log(msg: string): void {
  console.log(`[l2] ${msg}`);
}

function cleanPersistDir(): void {
  if (existsSync(PERSIST_ABS)) {
    rmSync(PERSIST_ABS, { recursive: true });
  }
  log("cleaned persist dir");
}

function applyMigrations(): void {
  const files = readdirSync(MIGRATIONS_DIR)
    .filter((f) => MIGRATION_FILE_RE.test(f))
    .sort();

  if (files.length === 0) {
    throw new Error(`No migration files found in ${MIGRATIONS_DIR}`);
  }

  for (const file of files) {
    const filePath = resolve(MIGRATIONS_DIR, file);
    log(`applying migration: ${file}`);
    execSync(
      `npx wrangler d1 execute otter-db --local --persist-to=${PERSIST_DIR} --file=${filePath}`,
      { cwd: WORKER_DIR, stdio: "pipe" },
    );
  }
  log(`applied ${files.length} migrations`);
}

function seedTestData(): void {
  // Insert _test_marker for consistency verification
  const seedSql = [
    "CREATE TABLE IF NOT EXISTS _test_marker (key TEXT PRIMARY KEY, value TEXT NOT NULL);",
    "INSERT OR REPLACE INTO _test_marker (key, value) VALUES ('env', 'test');",
  ].join(" ");
  execSync(
    `npx wrangler d1 execute otter-db --local --persist-to=${PERSIST_DIR} --command="${seedSql}"`,
    { cwd: WORKER_DIR, stdio: "pipe" },
  );
  log("seeded test marker");
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
  log(`spawning wrangler dev --local on :${PORT}`);
  wrangler = spawn(
    "npx",
    [
      "wrangler",
      "dev",
      "--local",
      "--port",
      String(PORT),
      "--inspector-port",
      "0",
      "--ip",
      "127.0.0.1",
      `--persist-to=${PERSIST_DIR}`,
    ],
    {
      cwd: WORKER_DIR,
      env: {
        ...process.env,
        WRANGLER_LOG: "error",
        NODE_ENV: "test",
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
  cleanPersistDir();
  applyMigrations();
  seedTestData();
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
