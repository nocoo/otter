import { execFileSync } from "node:child_process";
import { chmod, lstat, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import type { Collector, CollectorResult, Snapshot } from "@otter/core";
import { afterEach, beforeEach, expect, it } from "vitest";
import { validateSnapshotContents } from "../../../../../packages/api/src/lib/snapshot-payload";
import { AgentWorkspaceCollector } from "../../collectors/agent-workspace.js";
import { executeScan } from "../../commands/scan.js";
import { backupState } from "../../commands/workspace-state.js";
import { snapshotFiles } from "../../snapshot/content.js";
import { exportSnapshot } from "../../snapshot/export.js";
import { SnapshotStore } from "../../storage/local.js";
import { readStableFile } from "../../workspace/files.js";
import { observeGit } from "../../workspace/git.js";
import { addSource, editRegistry } from "../../workspace/registry.js";

let root: string, home: string, config: string;
async function put(path: string, content: string) {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, content);
}
const scan = () => executeScan([new AgentWorkspaceCollector(home, config)], { homeDir: home });
beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "otter-recovery-"));
  home = join(root, "home");
  config = join(root, "config");
  await mkdir(home);
});
afterEach(async () => {
  await rm(root, { force: true, recursive: true });
});

it("retains disabled Codex packages and inherited project instructions, respecting Grok compatibility flags", async () => {
  const shared = join(home, ".agents/skills/shared");
  await put(join(shared, "SKILL.md"), "Shared skill\n");
  await put(
    join(home, ".codex/config.toml"),
    '[[skills.config]]\npath = "~/.agents/skills/shared/SKILL.md"\nenabled = false\n',
  );
  await put(join(home, ".codex/prompts/old.md"), "Old prompt\n");
  await put(join(home, ".claude/CLAUDE.md"), "Claude instruction\n");
  await put(join(home, ".claude/commands/command.md"), "Claude command\n");
  await put(join(home, ".grok/config.toml"), "[compat.claude]\nskills = false\nagents = false\n");
  const project = join(home, "work/child");
  await mkdir(project, { recursive: true });
  await put(join(home, "work/AGENTS.md"), "Parent instructions\n");
  await put(join(project, ".claude/rules/local.md"), "Claude project rule\n");
  await editRegistry(config, (registry) => {
    registry.projects.push(project);
  });
  const first = await scan();
  expect(await validateSnapshotContents(first)).toBe(true);
  const resources = first.workspace?.resources ?? [];
  expect(resources.find((r) => r.path === shared)?.discovery).toContainEqual(
    expect.objectContaining({ agentId: "codex:default", state: "disabled" }),
  );
  expect(resources.find((r) => r.path.endsWith("prompts/old.md"))?.discovery).toContainEqual(
    expect.objectContaining({ state: "unsupported" }),
  );
  expect(resources.find((r) => r.path.endsWith(".claude/CLAUDE.md"))?.agentIds).toEqual([
    "claude:default",
  ]);
  expect(resources.find((r) => r.path.endsWith(".claude/rules/local.md"))?.agentIds).toEqual([
    "claude:default",
  ]);
  expect(resources.find((r) => r.path.endsWith("work/AGENTS.md"))?.discovery).toContainEqual(
    expect.objectContaining({ agentId: "codex:default", state: "project-only", cwd: project }),
  );
  expect(snapshotFiles(first).some((f) => f.content === "Shared skill\n")).toBe(true);
  await put(join(home, ".grok/config.toml"), "");
  const enabled = await scan();
  expect(
    enabled.workspace?.resources.find((r) => r.path.endsWith(".claude/CLAUDE.md"))?.agentIds,
  ).toContain("grok:default");
  expect(
    enabled.workspace?.resources.find((r) => r.path.endsWith(".claude/commands/command.md"))
      ?.agentIds,
  ).toContain("grok:default");
});

it("exports self-contained deduplicated links and explicitly registered standalone files after all original roots disappear", async () => {
  const source = join(root, "source");
  await put(join(source, "SKILL.md"), "Standalone package\n");
  await put(join(source, "scripts/run.sh"), "#!/bin/sh\necho restored\n");
  await chmod(join(source, "scripts/run.sh"), 0o755);
  await mkdir(join(source, "empty"), { mode: 0o751 });
  await symlink("scripts/run.sh", join(source, "run"));
  const extra = join(root, "outside/global.md");
  await put(extra, "Independent global file\n");
  await mkdir(join(home, ".claude/skills"), { recursive: true });
  await symlink(source, join(home, ".claude/skills/shared"));
  await editRegistry(config, (registry) => {
    addSource(registry, source);
    registry.bindings.push({ id: "extra", source: extra, target: extra, mode: "fork" });
  });
  const snapshot = await scan();
  expect(await validateSnapshotContents(snapshot)).toBe(true);
  expect(snapshot.collectors.flatMap((c) => c.files).some((f) => f.contentRef)).toBe(true);
  await rm(source, { recursive: true });
  await rm(join(root, "outside"), { recursive: true });
  const exported = await exportSnapshot(snapshot, join(root, "restored"));
  expect(
    await readFile(
      join(exported.directory, "roots/claude%3Adefault/skills/shared/SKILL.md"),
      "utf8",
    ),
  ).toBe("Standalone package\n");
  expect(
    (await lstat(join(exported.directory, "roots/claude%3Adefault/skills/shared/scripts/run.sh")))
      .mode & 0o777,
  ).toBe(0o755);
  expect(
    (await lstat(join(exported.directory, "roots/claude%3Adefault/skills/shared/run"))).mode &
      0o777,
  ).toBe(0o755);
  expect(
    (await lstat(join(exported.directory, "roots/claude%3Adefault/skills/shared/empty"))).mode &
      0o777,
  ).toBe(0o751);
  const external = snapshot.workspace?.roots.find((r) => r.path === extra);
  expect(external).toBeDefined();
  expect(
    await readFile(
      join(exported.directory, `roots/${encodeURIComponent(external?.id ?? "")}/global.md`),
      "utf8",
    ),
  ).toBe("Independent global file\n");
  await expect(exportSnapshot(snapshot, exported.directory)).rejects.toThrow();
});

it("commits only one local version per ID during concurrent writes, and keeps timestamped legacy files readable", async () => {
  await put(join(home, ".claude/CLAUDE.md"), "Saved\n");
  const snapshot = await scan(),
    changed = structuredClone(snapshot);
  changed.createdAt = "2026-01-01T00:00:00.000Z";
  const store = new SnapshotStore(join(root, "snapshots"));
  const results = await Promise.allSettled([store.save(snapshot), store.save(changed)]);
  expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
  expect(await store.list()).toHaveLength(1);
  const winner = await store.load(snapshot.id);
  expect(winner).not.toBeNull();
  await expect(store.save(winner as Snapshot)).resolves.toBeTruthy();
  const legacy = { ...snapshot, id: "legacy-id" };
  await writeFile(join(root, "snapshots/2026-09-01_legacy-id.json"), JSON.stringify(legacy));
  expect(await store.load("legacy-id")).toEqual(legacy);
  expect(await store.save(legacy)).toBe("2026-09-01_legacy-id.json");
});

it("does not parse pipes or symlinked pipes, records malformed JSONC, and reports corrupt Git metadata", async () => {
  await mkdir(join(home, ".codex"));
  execFileSync("mkfifo", [join(root, "pipe")]);
  await symlink(join(root, "pipe"), join(home, ".codex/config.toml"));
  await put(
    join(home, ".claude/settings.json"),
    '{"token":"do-not-copy-this-parse-error", invalid',
  );
  const snapshot = await scan();
  expect(snapshot.workspace?.coverage.complete).toBe(false);
  expect(JSON.stringify(snapshot)).not.toContain("do-not-copy-this-parse-error");
  await expect(readStableFile(join(root, "pipe"), 100)).rejects.toThrow("regular file");
  const file = join(root, "file");
  await put(file, "one");
  const expected = await lstat(file);
  await put(file, "two-more");
  await expect(readStableFile(file, 100, expected)).rejects.toThrow("changed");
  await expect(readStableFile(file, 1)).rejects.toThrow("limit");
  expect((await readStableFile(file, 100)).toString()).toBe("two-more");
  await put(join(root, "corrupt/.git"), "gitdir: /nonexistent-otter-test\n");
  expect(await observeGit(join(root, "corrupt"), config, "broken")).toMatchObject({
    repository: true,
    error: expect.any(String),
  });
});

it("does not declare unchanged protection based on a previous incomplete snapshot", async () => {
  await put(join(home, ".claude/CLAUDE.md"), "Saved\n");
  const current = await scan(),
    previous = structuredClone(current);
  if (!previous.workspace) throw new Error("Expected v2");
  previous.workspace.coverage.complete = false;
  const store = new SnapshotStore(join(root, "snapshots"));
  await store.save(previous);
  expect((await backupState(current, store)).state).toBe("needed");
  expect((await backupState({ ...current, workspace: undefined }, store)).state).toBe("unknown");
});

it("keeps legacy instruction comparisons explicit and records narrow watch scopes", async () => {
  const source = join(root, "workflow");
  const legacy = join(home, ".codex/instructions.md");
  await put(legacy, "Old instructions\n");
  await put(join(source, "agents/AGENTS.md"), "Current instructions\n");
  await put(join(home, ".claude.json"), "{}\n");
  await editRegistry(config, (registry) => {
    addSource(registry, source);
  });
  const snapshot = await scan();
  expect(snapshot.workspace?.resources.find((resource) => resource.path === legacy)).toMatchObject({
    counterpart: join(source, "agents/AGENTS.md"),
    relationship: "independent",
    discovery: [{ agentId: "codex:default", state: "unsupported", reason: expect.any(String) }],
  });
  expect(
    snapshot.workspace?.roots.find((captureRoot) => captureRoot.id === "claude:home")?.include,
  ).toEqual([".claude.json"]);
  const second = join(root, "other-workflow");
  await put(join(second, "agents/AGENTS.md"), "Ambiguous\n");
  await editRegistry(config, (registry) => {
    addSource(registry, second);
  });
  expect(
    (await scan()).workspace?.resources.find((resource) => resource.path === legacy)?.counterpart,
  ).toBeUndefined();
});

it("fingerprints the full environment separately from live configuration, redacts credentials and reports list-only coverage", async () => {
  await put(join(home, ".claude/CLAUDE.md"), "Global\n");
  const result: CollectorResult = {
    id: "environment",
    label: "Environment",
    category: "environment",
    durationMs: 0,
    files: [
      {
        path: join(home, "LaunchAgents/settings.plist"),
        content: "<key>API_TOKEN</key><string>private-value</string>",
        sizeBytes: 58,
      },
    ],
    lists: [
      { name: "Editor", version: "1" },
      { name: "Tool", meta: { channel: "stable", manager: "brew" } },
    ],
    errors: [],
    skipped: [],
  };
  const environment: Collector = { ...result, collect: async () => structuredClone(result) };
  const collectors = [new AgentWorkspaceCollector(home, config), environment];
  const first = await executeScan(collectors, { homeDir: home });
  expect(first.workspace?.coverage.complete).toBe(true);
  expect(JSON.stringify(first)).not.toContain("private-value");
  expect(first.workspace?.coverage.issues.map((issue) => issue.status)).toEqual(
    expect.arrayContaining(["redacted", "list-only"]),
  );
  result.lists = [{ name: "Editor", version: "2" }];
  result.files = [{ path: join(home, ".zshrc"), content: "export EDITOR=vim\n", sizeBytes: 18 }];
  const updated = await executeScan(collectors, { homeDir: home });
  expect(updated.workspace?.configurationFingerprint).toBe(
    first.workspace?.configurationFingerprint,
  );
  expect(updated.workspace?.contentFingerprint).not.toBe(first.workspace?.contentFingerprint);
  result.errors.push("Package manager unavailable");
  result.lists = [];
  const failed = await executeScan(collectors, { homeDir: home });
  expect(failed.workspace?.coverage.complete).toBe(false);
  expect(failed.workspace?.coverage.issues).toContainEqual({
    rootId: "environment",
    path: "environment",
    status: "error",
    reason: "Package manager unavailable",
  });
});

it("exports partial and legacy captures without inventing missing target content", async () => {
  await put(join(home, ".hermes/SOUL.md"), "Saved persona\n");
  await symlink("gone", join(home, ".hermes/AGENTS.md"));
  const snapshot = await scan();
  const exported = await exportSnapshot(snapshot, join(root, "partial"));
  expect(await readFile(join(exported.directory, "RESTORE.md"), "utf8")).toContain("partial");
  expect(JSON.parse(await readFile(join(exported.directory, "links.json"), "utf8"))).toContainEqual(
    expect.objectContaining({ materialized: "unavailable" }),
  );
  await expect(
    lstat(join(exported.directory, "roots/hermes%3Adefault/AGENTS.md")),
  ).rejects.toMatchObject({ code: "ENOENT" });
  const legacy = { ...snapshot, version: 1 as const };
  delete legacy.workspace;
  legacy.collectors = [
    {
      id: "legacy",
      label: "Legacy",
      category: "config",
      durationMs: 0,
      files: [{ path: join(home, ".zshrc"), content: "export EDITOR=vim\n", sizeBytes: 18 }],
      lists: [{ name: "Unrecoverable old skill" }],
      errors: [],
      skipped: [],
    },
  ];
  const old = await exportSnapshot(legacy, join(root, "legacy"));
  expect(await readFile(join(old.directory, "legacy/legacy/home/.zshrc"), "utf8")).toContain(
    "EDITOR",
  );
  expect(await readFile(join(old.directory, "RESTORE.md"), "utf8")).toContain(
    "Missing package content",
  );
  expect(await readFile(join(old.directory, "environment.json"), "utf8")).toContain(
    "Unrecoverable old skill",
  );
});
