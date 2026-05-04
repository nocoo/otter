#!/usr/bin/env bun
/**
 * L3 Vite SPA + worker runner — builds packages/web into packages/web/dist/
 * and starts `wrangler dev --local --persist-to` so a single port serves both
 * the SPA shell (via [assets]) and the new /api/* routes (D1 + R2 emulator).
 *
 * accessAuth auto-stamps localhost requests as `dev@localhost`, so the SPA
 * can hit /api/* without a JWT or Bearer token. Playwright uses this script
 * via `webServer.command`.
 */

import { readdirSync, rmSync } from "node:fs";
import { resolve } from "node:path";
import { type Subprocess, spawn, spawnSync } from "bun";

const PORT = Number(process.env.E2E_SPA_PORT ?? 27019);
const REPO_ROOT = resolve(import.meta.dir, "..");
const WEB_DIR = resolve(REPO_ROOT, "packages/web");
const WORKER_DIR = resolve(REPO_ROOT, "packages/worker");
const MIGRATIONS_DIR = resolve(WORKER_DIR, "migrations");
const PERSIST_DIR = ".wrangler/state-e2e-spa";
const HEALTH_TIMEOUT_MS = 60_000;
const MIGRATION_FILE_RE = /^\d{4}.*\.sql$/;

let wrangler: Subprocess | null = null;

function log(msg: string): void {
  console.log(`[e2e-spa] ${msg}`);
}

function buildSpa(): void {
  if (process.env.E2E_SKIP_BUILD === "true") {
    log("E2E_SKIP_BUILD=true — reusing existing packages/web/dist");
    return;
  }
  log("building Vite SPA → packages/web/dist/");
  const r = spawnSync(["bun", "run", "build"], {
    cwd: WEB_DIR,
    stdout: "inherit",
    stderr: "inherit",
  });
  if (r.exitCode !== 0) {
    throw new Error("vite build failed");
  }
}

function applySchema(): void {
  try {
    rmSync(resolve(WORKER_DIR, PERSIST_DIR), { recursive: true, force: true });
  } catch {
    // ignore
  }

  const files = readdirSync(MIGRATIONS_DIR)
    .filter((f) => MIGRATION_FILE_RE.test(f))
    .sort();

  if (files.length === 0) {
    throw new Error(`No migration files found in ${MIGRATIONS_DIR}`);
  }

  for (const file of files) {
    const filePath = resolve(MIGRATIONS_DIR, file);
    log(`applying ${file}`);
    const r = spawnSync(
      [
        "bunx",
        "wrangler",
        "d1",
        "execute",
        "otter-db",
        "--local",
        "--persist-to",
        PERSIST_DIR,
        `--file=${filePath}`,
      ],
      { cwd: WORKER_DIR, stdout: "pipe", stderr: "pipe" },
    );
    if (r.exitCode !== 0) {
      console.error(r.stdout?.toString());
      console.error(r.stderr?.toString());
      throw new Error(`schema apply failed for ${file}`);
    }
  }
  log(`applied ${files.length} migrations`);
}

async function waitForHealth(): Promise<void> {
  const url = `http://127.0.0.1:${PORT}/api/me`;
  const deadline = Date.now() + HEALTH_TIMEOUT_MS;
  let lastErr: unknown;
  while (Date.now() < deadline) {
    try {
      // biome-ignore lint/performance/noAwaitInLoops: poll loop
      const res = await fetch(url);
      if (res.status === 200 || res.status === 401) return;
    } catch (err) {
      lastErr = err;
    }
    await Bun.sleep(400);
  }
  throw new Error(`worker never became healthy on ${url}: ${String(lastErr)}`);
}

function startWrangler(): void {
  log(`starting wrangler dev --local on :${PORT}`);
  wrangler = spawn(
    [
      "bunx",
      "wrangler",
      "dev",
      "--local",
      "--persist-to",
      PERSIST_DIR,
      "--port",
      String(PORT),
      "--inspector-port",
      "0",
      "--ip",
      "127.0.0.1",
    ],
    {
      cwd: WORKER_DIR,
      stdout: "pipe",
      stderr: "pipe",
      env: { ...process.env, WRANGLER_LOG: "error" },
    },
  );
  const drain = async (stream: ReadableStream<Uint8Array>, label: string): Promise<void> => {
    const reader = stream.getReader();
    const dec = new TextDecoder();
    let chunk = await reader.read();
    while (!chunk.done) {
      if (chunk.value) process.stderr.write(`[${label}] ${dec.decode(chunk.value)}`);
      // biome-ignore lint/performance/noAwaitInLoops: stream pump must serialize reads
      chunk = await reader.read();
    }
  };
  void drain(wrangler.stdout as ReadableStream<Uint8Array>, "wrangler");
  void drain(wrangler.stderr as ReadableStream<Uint8Array>, "wrangler!");
}

async function stopWrangler(): Promise<void> {
  if (!wrangler) return;
  log("stopping wrangler dev");
  wrangler.kill("SIGTERM");
  const t = setTimeout(() => {
    if (wrangler && wrangler.exitCode === null) wrangler.kill("SIGKILL");
  }, 5_000);
  await wrangler.exited;
  clearTimeout(t);
  wrangler = null;
}

async function main(): Promise<void> {
  buildSpa();
  applySchema();
  startWrangler();
  await waitForHealth();
  log(`ready on http://127.0.0.1:${PORT}`);
  // Stay foreground so Playwright can manage lifetime.
  if (wrangler) await wrangler.exited;
}

const cleanup = async (): Promise<void> => {
  await stopWrangler();
  process.exit(process.exitCode ?? 0);
};
process.on("SIGINT", cleanup);
process.on("SIGTERM", cleanup);

await main();
