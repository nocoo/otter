import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { chmod, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import type { Snapshot } from "@otter/core";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { AgentWorkspaceCollector } from "../../collectors/agent-workspace.js";
import { executeScan } from "../../commands/scan.js";
import { diffSnapshots } from "../../commands/snapshot.js";
import { runWorkspaceCommand } from "../../commands/workspace.js";
import { backupState } from "../../commands/workspace-state.js";
import { snapshotFiles } from "../../snapshot/content.js";
import { exportSnapshot } from "../../snapshot/export.js";
import { SnapshotStore } from "../../storage/local.js";
import { redactCapturedText } from "../../utils/redact.js";
import { FileCapture, resolvePath } from "../../workspace/files.js";
import {
  addSource,
  deviceIdentity,
  editRegistry,
  importWorkspace,
  readRegistry,
} from "../../workspace/registry.js";

function required<T>(value: T | null | undefined): T {
  assert(value !== null && value !== undefined, "Required fixture value is missing");
  return value;
}

let root: string, home: string, config: string, source: string;
async function put(path: string, value: string | Uint8Array) {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, value);
}
async function scan() {
  return executeScan([new AgentWorkspaceCollector(home, config)], { homeDir: home });
}
async function call(args: string[]) {
  let output = "";
  const code = await runWorkspaceCommand(
    [
      ...args,
      "--json",
      "--config-dir",
      config,
      "--scan-root",
      home,
      "--output-dir",
      join(root, "snapshots"),
    ],
    "3.0.0",
    {
      stdout: (text) => {
        output += text;
      },
      stderr: () => undefined,
    },
  );
  return { code, value: JSON.parse(output) };
}
beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "otter-v2-"));
  home = join(root, "home");
  config = join(root, "config");
  source = join(root, "workflow");
  await mkdir(home);
  await put(join(source, "agents/AGENTS.md"), "Shared instructions\n");
  await put(
    join(source, "unusual/deep/skills/tool/SKILL.md"),
    "---\nname: tool\ndescription: A shared skill\n---\nRead references/guide.md.\n",
  );
  await put(join(source, "unusual/deep/skills/tool/scripts/run.sh"), "#!/bin/sh\necho fixture\n");
  await chmod(join(source, "unusual/deep/skills/tool/scripts/run.sh"), 0o755);
  await put(
    join(source, "unusual/deep/skills/tool/references/guide.md"),
    "Recovery must include this guide.\n",
  );
  await put(
    join(source, "unusual/deep/skills/tool/assets/icon.png"),
    new Uint8Array([137, 80, 78, 71, 0, 255]),
  );
  await editRegistry(config, (registry) => addSource(registry, source));
});
afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

describe("v2 configuration protection", () => {
  it("captures multiple sources, seven agents, independent packages and Hermes external profile roots", async () => {
    const homes = [
      ".claude",
      ".codex",
      ".grok",
      ".pi/agent",
      ".gemini",
      ".config/opencode",
      ".hermes",
      ".hermes/profiles/cherry",
      ".hermes/profiles/work",
    ];
    await Promise.all(
      homes.map(async (folder) => {
        await put(join(home, folder, "skills/local/SKILL.md"), `${folder} skill\n`);
        await put(join(home, folder, "skills/local/scripts/run.sh"), `echo '${folder}'\n`);
        await put(join(home, folder, "rules/local.md"), "A rule\n");
        await put(join(home, folder, "commands/local.md"), "A command\n");
        await put(join(home, folder, "AGENTS.md"), "Global instruction\n");
      }),
    );
    await put(
      join(home, ".hermes/profiles/cherry/config.yaml"),
      `skills:\n  external_dirs:\n    - ${join(root, "external")}\napi_key: secret-value\n`,
    );
    await put(join(home, ".hermes/profiles/cherry/SOUL.md"), "Cherry persona\n");
    await put(join(home, ".hermes/profiles/cherry/memories/USER.md"), "Cherry user\n");
    await put(join(root, "external/category/tool/SKILL.md"), "External profile skill\n");
    await put(join(root, "second/rules/team.md"), "Second source\n");
    await editRegistry(config, (registry) => addSource(registry, join(root, "second")));
    const snapshot = await scan();
    expect(snapshot.version).toBe(2);
    expect(snapshot.workspace?.agents).toHaveLength(9);
    expect(snapshot.workspace?.roots.filter((r) => r.role === "source")).toHaveLength(2);
    expect(snapshot.workspace?.coverage.complete).toBe(true);
    expect(
      snapshot.workspace?.resources.filter(
        (r) => r.kind === "skill" && r.relationship === "independent",
      ),
    ).toHaveLength(9);
    const files = snapshot.collectors[0]?.files ?? [];
    expect(files.some((f) => f.content.includes("External profile skill"))).toBe(true);
    expect(files.some((f) => f.content.includes("Cherry persona"))).toBe(true);
    expect(JSON.stringify(snapshot)).not.toContain("secret-value");
    expect(snapshot.workspace?.coverage.issues.some((i) => i.status === "redacted")).toBe(true);
    expect(files.some((f) => f.path.endsWith("icon.png") && f.encoding === "base64")).toBe(true);
    expect(files.some((f) => f.path.endsWith("run.sh") && f.mode === 0o755)).toBe(true);
  });

  it("saves link chains and target bytes, including parent aliases and files outside packages", async () => {
    await mkdir(join(home, ".claude/skills"), { recursive: true });
    await symlink(join(source, "unusual/deep/skills/tool"), join(home, ".claude/skills/tool"));
    await symlink(join(source, "agents/AGENTS.md"), join(root, "shared-instructions"));
    await symlink(join(root, "shared-instructions"), join(home, ".claude/CLAUDE.md"));
    await symlink(
      join(source, "agents/AGENTS.md"),
      join(source, "unusual/deep/skills/tool/references/outside.md"),
    );
    await symlink(join(home, ".claude"), join(home, ".codex"));
    const snapshot = await scan();
    const entry = snapshotFiles(snapshot).find((f) => f.path === join(home, ".claude/CLAUDE.md"));
    expect(entry).toMatchObject({ kind: "symlink", content: "Shared instructions\n" });
    expect(entry?.links?.filter((l) => l.path !== "/var")).toHaveLength(2);
    expect(
      snapshot.workspace?.resources.find((r) => r.path === join(home, ".claude/skills/tool")),
    ).toMatchObject({
      relationship: "symlink",
      counterpart: join(source, "unusual/deep/skills/tool"),
    });
    expect(
      snapshot.collectors[0]?.files.find(
        (f) => f.path === join(home, ".codex/skills/tool/references/outside.md"),
      )?.links?.length,
    ).toBeGreaterThan(1);
    const exported = await exportSnapshot(snapshot, join(root, "recovered"));
    const sourceId = snapshot.workspace?.registry.sources[0]?.id;
    expect(
      await readFile(
        join(
          exported.directory,
          `roots/${sourceId}/unusual/deep/skills/tool/references/outside.md`,
        ),
        "utf8",
      ),
    ).toBe("Shared instructions\n");
    expect(
      JSON.parse(await readFile(join(exported.directory, "links.json"), "utf8")).length,
    ).toBeGreaterThan(1);
    expect(await readFile(join(exported.directory, "RESTORE.md"), "utf8")).toContain(
      "materialized",
    );
  });

  it("keeps malformed skills and reports broken links, cycles, missing sources and unavailable configured roots", async () => {
    await put(join(home, ".hermes/skills/draft/only-file.txt"), "Not yet a valid skill\n");
    await put(
      join(home, ".hermes/config.yaml"),
      'skills:\n  external_dirs: ["/otter-fixture-missing"]\n',
    );
    await symlink("missing-target", join(source, "broken"));
    await symlink("loop-b", join(source, "loop-a"));
    await symlink("loop-a", join(source, "loop-b"));
    await symlink(".", join(source, "directory-cycle"));
    await editRegistry(config, (registry) => addSource(registry, join(root, "offline-disk")));
    const snapshot = await scan();
    expect(snapshot.workspace?.coverage.complete).toBe(false);
    expect(snapshot.workspace?.coverage.issues.map((i) => i.status)).toContain("invalid");
    expect(snapshot.collectors[0]?.files.some((f) => f.content === "Not yet a valid skill\n")).toBe(
      true,
    );
    expect(snapshot.workspace?.coverage.issues.some((i) => i.reason.includes("cycle"))).toBe(true);
    expect((await resolvePath(join(source, "loop-a"))).error).toBeTruthy();
    const reference = structuredClone(snapshot);
    required(reference.workspace).coverage.complete = true;
    required(reference.collectors[0]).files.push({
      path: "/unknown-before",
      content: "old",
      sizeBytes: 3,
    });
    expect(diffSnapshots(reference, snapshot).coverageWarning).toContain("unknown");
    expect(
      diffSnapshots(reference, snapshot)
        .collectors.flatMap((c) => c.files)
        .some((f) => f.type === "removed"),
    ).toBe(false);
  });

  it("detects content, mode, link and scope changes while ignoring observation time and UUID", async () => {
    const store = new SnapshotStore(join(root, "snapshots"));
    const before = await scan();
    await store.save(before);
    const again = await scan();
    expect(again.id).not.toBe(before.id);
    expect(again.workspace?.contentFingerprint).toBe(before.workspace?.contentFingerprint);
    expect((await backupState(again, store)).state).toBe("unchanged");
    const path = join(source, "agents/AGENTS.md");
    await put(path, "Edited instructions\n");
    const edited = await scan();
    expect(edited.workspace?.contentFingerprint).not.toBe(before.workspace?.contentFingerprint);
    expect(
      diffSnapshots(before, edited).collectors[0]?.files.some((f) => f.type === "changed"),
    ).toBe(true);
    expect((await backupState(edited, store)).state).toBe("needed");
    await chmod(path, 0o700);
    const chmodded = await scan();
    expect(diffSnapshots(edited, chmodded).collectors[0]?.files).toHaveLength(1);
    await put(join(root, "other/file.md"), "Other\n");
    await call(["source", "add", join(root, "other")]);
    expect((await backupState(await scan(), store)).state).toBe("scope-changed");
    expect((await call(["workspace", "inspect"])).value.backup.state).toBe("scope-changed");
    const firstId = before.workspace?.registry.sources[0]?.id as string;
    expect((await call(["source", "fetch", firstId])).value.repository).toBe(false);
    expect((await call(["source", "remove", firstId])).value.sources).toHaveLength(1);
  });

  it("saves before authentication and rejects overwrite, unsafe export paths and changed bytes", async () => {
    const result = await call([
      "backup",
      "--collectors",
      "agent-workspace",
      "--api-url",
      "http://127.0.0.1:1",
    ]);
    expect(result.code).toBe(1);
    expect(result.value.error.message).toContain("saved locally");
    const store = new SnapshotStore(join(root, "snapshots"));
    const list = await store.list();
    expect(list).toHaveLength(1);
    const snapshot = (await store.load(required(list[0]).id)) as Snapshot;
    await expect(store.save(snapshot)).resolves.toBeTruthy();
    const changed = structuredClone(snapshot);
    required(changed.collectors[0]?.files[0]).content = "changed";
    await expect(store.save(changed)).rejects.toThrow("different content");
    const file = required(snapshot.collectors[0]?.files.find((f) => f.sha256));
    file.content += "tampered";
    await expect(exportSnapshot(snapshot, join(root, "invalid"))).rejects.toThrow(
      "digest mismatch",
    );
    file.relativePath = "../escape";
    await expect(exportSnapshot(snapshot, join(root, "invalid"))).rejects.toThrow(
      "Unsafe snapshot path",
    );
    await expect(exportSnapshot(snapshot, "relative")).rejects.toThrow("absolute");
  });

  it("migrates sources and bindings without overwriting CLI registrations and retains a private original", async () => {
    const path = join(root, "mac.json");
    await put(
      path,
      JSON.stringify({
        sources: [source, join(root, "second")],
        projects: [join(root, "project")],
        bindings: [{ id: "copy", source: "/source", target: "/target", mode: "copy" }],
      }),
    );
    const migrated = await importWorkspace(config, path);
    expect(migrated.sources).toHaveLength(2);
    expect((await importWorkspace(config, path)).sources[0]?.id).toBe(migrated.sources[0]?.id);
    expect(await readFile(join(config, "workspace.macos-import.json"), "utf8")).toBe(
      await readFile(path, "utf8"),
    );
    await put(
      path,
      JSON.stringify({
        sources: [],
        projects: [],
        bindings: [{ id: "fork", source: "/other", target: "/target", mode: "fork" }],
      }),
    );
    await expect(importWorkspace(config, path)).rejects.toThrow("Binding conflict");
    expect((await readRegistry(config)).bindings[0]?.mode).toBe("copy");
    expect(await deviceIdentity(config)).toBe(await deviceIdentity(config));
    await put(join(config, "workspace.json"), '{"version":99}');
    await expect(scan()).rejects.toThrow();
  });

  it("reports excluded credentials, special files and explicit entry/size/depth limits", async () => {
    await put(join(source, ".env"), "SECRET=value");
    await put(join(source, "node_modules/module.js"), "generated");
    execFileSync("mkfifo", [join(source, "pipe")]);
    const plan = {
      root: {
        id: "root",
        path: source,
        label: "source",
        role: "source" as const,
        agentIds: [],
        status: "complete" as const,
      },
    };
    const capture = new FileCapture({
      version: 1,
      maxFileBytes: 10,
      maxTotalBytes: 1000,
      maxDepth: 3,
      maxEntries: 100,
    });
    await capture.capture(plan);
    expect(capture.issues.some((i) => i.status === "excluded" && i.path.endsWith(".env"))).toBe(
      true,
    );
    expect(capture.issues.some((i) => i.reason.includes("Special"))).toBe(true);
    expect(capture.issues.some((i) => i.status === "limit")).toBe(true);
    const limited = new FileCapture({ ...capture.policy, maxEntries: 1 });
    await limited.capture(plan);
    expect(limited.files).toHaveLength(1);
  });

  it("redacts TOML, JSONC, YAML, malformed configuration, Markdown credentials and shell secrets", () => {
    for (const [path, content] of [
      ["config.toml", 'api_key = "sensitive"\nmodel = "test"\n'],
      ["config.jsonc", '// comment\n{"password": "sensitive", "enabled": true,}'],
      ["config.yaml", "auth:\n  token: sensitive\nmodel: test\n"],
      ["broken.toml", "not valid [\napi_key=sensitive\n"],
      ["broken.json", '{"token": "sensitive", BAD'],
      ["script.sh", 'export API_KEY="sensitive"'],
      ["SKILL.md", `example: sk-ant-${"x".repeat(30)}`],
    ]) {
      const redacted = redactCapturedText(required(content), required(path));
      expect(redacted).toContain("[REDACTED]");
      expect(redacted).not.toContain("sensitive");
    }
    expect(redactCapturedText('model = "test"\n', "config.toml")).toBe('model = "test"\n');
  });
});
