#!/usr/bin/env bun
// Orchestrate L1 pre-commit stages in parallel inside the index snapshot (cwd).
// Invoked from .husky/pre-commit after git checkout-index.
import { existsSync } from "node:fs";

const start = performance.now();

const biomeFiles = (process.env.OTTER_PRECOMMIT_BIOME_FILES ?? "")
  .split(/[\n\r\s]+/)
  .map((line) => line.trim())
  .filter(Boolean);

type Stage = { name: string; cmd: string[] };
const stages: Stage[] = [];

if (biomeFiles.length > 0) {
  stages.push({
    name: "biome",
    cmd: [
      "./node_modules/.bin/biome",
      "check",
      "--error-on-warnings",
      "--no-errors-on-unmatched",
      "--files-ignore-unknown=true",
      ...biomeFiles,
    ],
  });
}

stages.push(
  { name: "coverage", cmd: ["bun", "run", "test:coverage"] },
  {
    name: "typecheck",
    cmd: [
      "./node_modules/.bin/tsc",
      "-b",
      "packages/core",
      "apps/cli",
      "apps/web",
      "packages/api",
      "apps/api",
    ],
  },
);

const launched = stages.map((s) => {
  const t0 = performance.now();
  const proc = Bun.spawn(s.cmd, { stdout: "pipe", stderr: "pipe", cwd: process.cwd() });
  return { ...s, proc, t0 };
});

const results = await Promise.all(
  launched.map(async (s) => {
    const exit = await s.proc.exited;
    const dur = performance.now() - s.t0;
    const stdout = await new Response(s.proc.stdout).text();
    const stderr = await new Response(s.proc.stderr).text();
    return { ...s, exit, dur, stdout, stderr };
  }),
);

let failed = false;
for (const r of results) {
  const tag = r.exit === 0 ? "✓" : "✗";
  process.stderr.write(`━━━ ${tag} ${r.name} (exit=${r.exit}, ${r.dur.toFixed(0)}ms) ━━━\n`);
  if (r.exit !== 0) {
    failed = true;
    process.stderr.write(r.stdout);
    process.stderr.write(r.stderr);
  }
}

const cov = results.find((r) => r.name === "coverage");
if (cov?.exit === 0 && !existsSync("coverage")) {
  failed = true;
  process.stderr.write("pre-commit: coverage output directory missing\n");
}

const total = (performance.now() - start).toFixed(0);
if (failed) {
  process.stderr.write(`❌ pre-commit failed in ${total}ms\n`);
  process.exit(1);
}
const biomeNote = biomeFiles.length === 0 ? " (biome skipped: no staged lintable files)" : "";
process.stderr.write(
  `✅ pre-commit: L1 index snapshot (biome + coverage + typecheck) passed in ${total}ms${biomeNote}\n`,
);
