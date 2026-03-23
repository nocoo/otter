/**
 * Shared E2E utilities for test runner scripts.
 */

import { existsSync, rmSync } from "node:fs";

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
