#!/usr/bin/env bun
// Orchestrate pre-commit stages in parallel using Bun.spawn.
// Replaces the previous bash background-process structure to cut shell/process
// coordination overhead by ~100ms (median 0.59s vs 0.70s wall).
// Stages (all run in parallel):
//   • lint       = G1 lint-staged (Biome)
//   • unit       = L1 vitest tests (coverage runs at pre-push)
//   • typecheck  = `tsc -b` over all packages (incremental)
//   • gitleaks   = staged-only secret scan (full history runs at pre-push)
const start = performance.now();

type Stage = { name: string; cmd: string[] };
const stages: Stage[] = [
  { name: "lint", cmd: ["bunx", "lint-staged"] },
  { name: "unit", cmd: ["bun", "run", "test"] },
  { name: "typecheck", cmd: ["bun", "run", "lint"] },
  { name: "gitleaks", cmd: ["gitleaks", "protect", "--staged", "--no-banner"] },
];

const launched = stages.map((s) => {
  const t0 = performance.now();
  const proc = Bun.spawn(s.cmd, { stdout: "pipe", stderr: "pipe" });
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

const total = (performance.now() - start).toFixed(0);
if (failed) {
  process.stderr.write(`❌ pre-commit failed in ${total}ms\n`);
  process.exit(1);
}
process.stderr.write(
  `✅ pre-commit: G1 + L1 (tests, no coverage) + tsc + gitleaks passed in ${total}ms\n`,
);
