import assert from "node:assert/strict";
import { chmod, cp, mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AgentWorkspaceCollector } from "../../collectors/agent-workspace.js";
import { executeScan } from "../../commands/scan.js";
import { backupState } from "../../commands/workspace-state.js";
import { snapshotFiles } from "../../snapshot/content.js";
import { SnapshotStore } from "../../storage/local.js";
import { discoverWorkspace } from "../../workspace/discovery.js";
import { FileCapture } from "../../workspace/files.js";
import {
  addSource,
  deviceIdentity,
  editRegistry,
  importWorkspace,
  readRegistry,
  syncWorkspace,
} from "../../workspace/registry.js";

function required<T>(value: T | null | undefined): T {
  assert(value !== null && value !== undefined, "Required fixture value is missing");
  return value;
}

let root: string, home: string, config: string;
async function put(path: string, content: string) {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, content);
}
const empty = () => ({ version: 1 as const, sources: [], projects: [], bindings: [] });
beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "otter-discover-"));
  home = join(root, "home");
  config = join(root, "config");
  await mkdir(home);
});
afterEach(async () => {
  vi.unstubAllEnvs();
  await rm(root, { force: true, recursive: true });
});
async function scan() {
  return executeScan([new AgentWorkspaceCollector(home, config)], { homeDir: home });
}

describe("workspace discovery and registry", () => {
  it("discovers Codex explicit instructions/disabled skill packages, shared roots, project entries and installed Claude plugin caches", async () => {
    await put(
      join(home, ".codex/config.toml"),
      'model_instructions_file = "~/custom.md"\n[[skills.config]]\npath = "~/local/SKILL.md"\nenabled = false\n',
    );
    await put(join(home, "custom.md"), "Custom\n");
    await put(join(home, "local/SKILL.md"), "Local skill\n");
    await put(join(home, ".agents/skills/shared/SKILL.md"), "Shared\n");
    await put(join(home, ".claude.json"), '{"token":"private-value"}');
    await put(
      join(home, ".claude/plugins/installed_plugins.json"),
      JSON.stringify({
        plugins: { "test-plugin": [{ installPath: join(root, "cache/plugin") }, {}] },
      }),
    );
    await put(join(root, "cache/plugin/skills/plugin/SKILL.md"), "Plugin\n");
    const project = join(root, "project");
    await put(join(project, ".codex/rules/rule.md"), "Project rule\n");
    await editRegistry(config, (registry) => {
      registry.projects.push(project);
    });
    const snapshot = await scan();
    expect(snapshot.workspace?.coverage.complete).toBe(true);
    expect(snapshotFiles(snapshot).some((f) => f.content === "Plugin\n")).toBe(true);
    expect(
      snapshot.workspace?.resources.filter((r) => r.path === join(home, "local")),
    ).toHaveLength(1);
    expect(
      snapshot.workspace?.resources.some((r) => r.path.endsWith("project/.codex/rules/rule.md")),
    ).toBe(true);
    expect(JSON.stringify(snapshot)).not.toContain("private-value");
  });
  it("reports malformed config references, plugin registries and unreadable profiles instead of claiming full coverage", async () => {
    await put(join(home, ".codex/config.toml"), "not [ valid");
    await put(join(home, ".hermes/config.yaml"), "skills:\n  external_dirs: 123\n");
    await put(join(home, ".hermes/profiles"), "not a directory");
    await put(join(home, ".claude/plugins/installed_plugins.json"), "not json");
    const snapshot = await scan();
    expect(snapshot.workspace?.coverage.complete).toBe(false);
    expect(
      snapshot.workspace?.coverage.issues.filter((i) => i.status === "error").length,
    ).toBeGreaterThanOrEqual(4);
    await put(join(home, ".codex/config.toml"), " ".repeat(1024 * 1024 + 1));
    expect(
      (await scan()).workspace?.coverage.issues.some((i) => i.reason.includes("read limit")),
    ).toBe(true);
  });
  it("merges Mac changes with CLI additions and removals, preserves identity, and detects conflicting bindings", async () => {
    const path = join(root, "preferences.json"),
      source = join(root, "source");
    const prefs = {
      sources: [source],
      projects: [join(root, "project")],
      bindings: [{ id: "copy", source: "/s", target: "/t", mode: "copy" }],
    };
    await put(path, JSON.stringify(prefs));
    await syncWorkspace(config, path);
    await editRegistry(config, (r) => addSource(r, join(root, "cli-added")));
    prefs.sources = [];
    prefs.bindings = [];
    await put(path, JSON.stringify(prefs));
    expect((await syncWorkspace(config, path)).sources.map((s) => s.path)).toEqual([
      join(root, "cli-added"),
    ]);
    expect((await readRegistry(config)).bindings).toEqual([]);
    prefs.sources = [source];
    prefs.bindings = [{ id: "copy", source: "/s", target: "/t", mode: "copy" }];
    await put(path, JSON.stringify(prefs));
    await syncWorkspace(config, path);
    await editRegistry(config, (r) => {
      required(r.bindings[0]).source = "/cli-change";
    });
    required(prefs.bindings[0]).source = "/mac-change";
    await put(path, JSON.stringify(prefs));
    await expect(syncWorkspace(config, path)).rejects.toThrow("Binding conflict");
    await put(join(config, "device.json"), '{"id":"invalid"}');
    await expect(deviceIdentity(config)).rejects.toThrow("Invalid device");
    await expect(importWorkspace(config, path)).rejects.toThrow("Binding conflict");
    await put(path, "{}");
    await expect(importWorkspace(config, path)).rejects.toThrow("Invalid Mac");
    await put(path, '{"sources":[],"projects":["relative"]}');
    await expect(importWorkspace(config, path)).rejects.toThrow("absolute");
    await expect(editRegistry(config, (r) => addSource(r, "relative"))).rejects.toThrow("absolute");
    await put(join(config, "workspace.lock"), "already locked");
    await expect(editRegistry(config, () => undefined)).rejects.toThrow();
  });
  it("avoids spending the unique-content budget repeatedly on aliases and validates local content references", async () => {
    const source = join(root, "source");
    await put(join(source, "SKILL.md"), "A skill\n");
    await put(join(source, "large.txt"), "a".repeat(100));
    await mkdir(join(home, ".claude/skills"), { recursive: true });
    await symlink(source, join(home, ".claude/skills/linked"));
    const capture = new FileCapture({
      version: 1,
      maxFileBytes: 200,
      maxTotalBytes: 120,
      maxEntries: 100,
      maxDepth: 10,
    });
    for (const path of [source, join(home, ".claude/skills/linked")]) {
      // biome-ignore lint/performance/noAwaitInLoops: aliases share one deterministic capture budget
      await capture.capture({
        root: { id: path, path, label: "test", agentIds: [], role: "source", status: "complete" },
      });
    }
    expect(capture.bytes).toBe(108);
    expect(capture.files.filter((f) => f.contentRef)).toHaveLength(2);
    await editRegistry(config, (r) => addSource(r, source));
    const snapshot = await scan();
    expect(snapshotFiles(snapshot).filter((f) => f.content === "a".repeat(100))).toHaveLength(2);
    const reference = required(snapshot.collectors[0]?.files.find((f) => f.contentRef));
    reference.contentRef = "invalid";
    expect(() => snapshotFiles(snapshot)).toThrow("Invalid snapshot content");
    const limited = new FileCapture({ ...capture.policy, maxTotalBytes: 10 });
    await limited.capture({
      root: {
        id: "test",
        path: source,
        label: "test",
        agentIds: [],
        role: "source",
        status: "complete",
      },
    });
    expect(limited.issues.some((i) => i.status === "limit")).toBe(true);
  });
  it("retains copy baselines, forks, independent copies, source-only packages and permission failures", async () => {
    const source = join(root, "source");
    await put(join(source, "skills/a/SKILL.md"), "Skill a\n");
    const target = join(home, ".claude/skills/a");
    await cp(join(source, "skills/a"), target, { recursive: true });
    await editRegistry(config, (r) => addSource(r, source));
    const same = await scan();
    expect(same.workspace?.resources.find((r) => r.path === target)?.relationship).toBe(
      "equalContent",
    );
    const baseline = required(same.workspace?.resources.find((r) => r.path === target)).digest;
    await editRegistry(config, (r) => {
      r.bindings.push({
        id: "copy",
        source: join(source, "skills/a"),
        target,
        mode: "copy",
        baseSource: baseline,
        baseTarget: baseline,
      });
    });
    expect((await scan()).workspace?.resources.find((r) => r.path === target)?.relationship).toBe(
      "managedCopy",
    );
    await put(join(source, "skills/a/SKILL.md"), "Changed source\n");
    expect((await scan()).workspace?.resources.find((r) => r.path === target)?.relationship).toBe(
      "sourceChanged",
    );
    await put(join(source, "skills/a/SKILL.md"), "Skill a\n");
    await put(join(target, "SKILL.md"), "Changed local\n");
    expect((await scan()).workspace?.resources.find((r) => r.path === target)?.relationship).toBe(
      "localChanged",
    );
    await put(join(source, "skills/a/SKILL.md"), "Changed source\n");
    expect((await scan()).workspace?.resources.find((r) => r.path === target)?.relationship).toBe(
      "bothChanged",
    );
    await editRegistry(config, (r) => {
      required(r.bindings[0]).mode = "fork";
    });
    expect((await scan()).workspace?.resources.find((r) => r.path === target)?.relationship).toBe(
      "fork",
    );
    await chmod(source, 0o000);
    const denied = await scan();
    await chmod(source, 0o700);
    expect(denied.workspace?.coverage.complete).toBe(false);
    expect((await backupState(denied, new SnapshotStore(join(root, "snapshots"))))["state"]).toBe(
      "unknown",
    );
  });
  it("records binary locations without needing live conversations", async () => {
    const bin = join(root, "bin");
    await Promise.all(
      ["claude", "codex", "grok", "pi", "hermes", "opencode", "gemini"].map(async (name) => {
        await put(
          join(bin, name),
          `#!/bin/sh\n${name === "grok" ? "exit 1" : "echo 'fixture 1.0'"}\n`,
        );
        await chmod(join(bin, name), 0o755);
      }),
    );
    vi.stubEnv("PATH", bin);
    const discovered = await discoverWorkspace(home, empty(), true);
    expect(discovered.agents).toHaveLength(7);
    expect(discovered.agents.find((a) => a.kind === "claude")?.version).toBe("fixture 1.0");
    expect(discovered.agents.find((a) => a.kind === "grok")?.version).toBeUndefined();
    expect(discovered.plans).toHaveLength(0);
  });

  it("treats reordered Mac JSON keys as the same binding and rejects malformed registry paths", async () => {
    const path = join(root, "mac.json");
    const binding = { id: "binding", source: "/source", target: "/target", mode: "link" };
    await put(path, JSON.stringify({ sources: [], projects: [], bindings: [binding] }));
    await syncWorkspace(config, path);
    await put(
      path,
      JSON.stringify({
        sources: [],
        projects: [],
        bindings: [
          { mode: binding.mode, target: binding.target, source: binding.source, id: binding.id },
        ],
      }),
    );
    expect((await syncWorkspace(config, path)).bindings).toEqual([binding]);
    await expect(
      editRegistry(config, (registry) => addSource(registry, "/contains\0null")),
    ).rejects.toThrow("absolute");
    await put(
      join(config, "workspace.json"),
      JSON.stringify({
        version: 1,
        sources: [{ id: "invalid", label: "fixture", path: "relative" }],
        projects: [],
        bindings: [],
      }),
    );
    await expect(readRegistry(config)).rejects.toThrow("Invalid workspace");
    await put(join(config, "device.json"), JSON.stringify({ id: "-".repeat(36) }));
    await expect(deviceIdentity(config)).rejects.toThrow("Invalid device");
  });
});
