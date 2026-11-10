#!/usr/bin/env bun
/** Smoke probes for index-snapshot pre-commit (run from a clean worktree). */
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const repo = join(import.meta.dir, "..");

function runHook(cwd: string): { status: number; output: string } {
  try {
    execFileSync("sh", [".husky/pre-commit"], {
      cwd,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
    return { status: 0, output: "" };
  } catch (err) {
    const e = err as { status?: number; stdout?: string; stderr?: string };
    return { status: e.status ?? 1, output: `${e.stdout ?? ""}${e.stderr ?? ""}` };
  }
}

const pkgPath = join(repo, "package.json");
const pkgBackup = readFileSync(pkgPath, "utf8");
let failed = 0;

const check = (name: string, ok: boolean, detail = "") => {
  console.log(`${ok ? "ok" : "FAIL"} ${name}${detail ? `: ${detail.slice(0, 240)}` : ""}`);
  if (!ok) failed = 1;
};

try {
  const good = runHook(repo);
  check("healthy repository hook exits 0", good.status === 0, good.output);

  const pkg = JSON.parse(pkgBackup) as { scripts: Record<string, string> };
  pkg.scripts["test:coverage"] = "vitest run";
  writeFileSync(pkgPath, `${JSON.stringify(pkg, null, 2)}\n`);
  execFileSync("git", ["add", "--", "package.json"], { cwd: repo });
  const badCov = runHook(repo);
  check(
    "staged package.json without --coverage is rejected",
    badCov.status !== 0 && /test:coverage must run vitest with --coverage/i.test(badCov.output),
    badCov.output,
  );
  execFileSync("git", ["reset", "HEAD", "--", "package.json"], { cwd: repo });
  writeFileSync(pkgPath, pkgBackup);
} finally {
  writeFileSync(pkgPath, pkgBackup);
}

if (failed) process.exit(failed);
console.log("L1 gate smoke probes passed");
