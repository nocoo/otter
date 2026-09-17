import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, stat, symlink, writeFile } from "node:fs/promises";
import { createServer, type Server } from "node:http";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { gunzipSync } from "node:zlib";
import type { Snapshot } from "@otter/core";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { diffSnapshots } from "../../commands/snapshot.js";
import {
  runWorkspaceCommand,
  snapshotDigest,
  validatedApiUrl,
  workspaceConfigDirectory,
} from "../../commands/workspace.js";
import { SnapshotStore } from "../../storage/local.js";

let root: string;
let home: string;
let config: string;
let snapshots: string;
let server: Server | undefined;

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "otter-protocol-"));
  home = join(root, "fixture-home");
  config = join(root, "config");
  snapshots = join(root, "snapshots");
  await mkdir(join(home, ".hermes/skills/category/nested"), { recursive: true });
  await mkdir(config);
  await writeFile(join(home, ".zshrc"), "export EDITOR=vim\n");
  await writeFile(join(home, ".hermes/SOUL.md"), "Fixture persona\n");
  await writeFile(
    join(home, ".hermes/skills/category/nested/SKILL.md"),
    "---\nname: nested\ndescription: A nested skill.\n---\n",
  );
  await mkdir(join(root, "source/linked"), { recursive: true });
  await writeFile(
    join(root, "source/linked/SKILL.md"),
    "---\nname: linked\ndescription: Linked skill.\n---\n",
  );
  await symlink(join(root, "source/linked"), join(home, ".hermes/skills/linked"));
});
afterEach(async () => {
  vi.unstubAllEnvs();
  if (server) {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server?.close(() => resolve()));
    server = undefined;
  }
  await rm(root, { recursive: true, force: true });
});

async function invoke(args: string[]) {
  let stdout = "",
    stderr = "";
  const code = await runWorkspaceCommand(
    [...args, "--config-dir", config, "--output-dir", snapshots],
    "test-version",
    {
      stdout: (value) => {
        stdout += value;
      },
      stderr: (value) => {
        stderr += value;
      },
    },
  );
  return { code, stdout, stderr, value: stdout.trim() ? JSON.parse(stdout) : undefined };
}
async function scan(): Promise<Snapshot> {
  return (
    await invoke([
      "scan",
      "--json",
      "--save",
      "--scan-root",
      home,
      "--collectors",
      "shell-config,hermes",
    ])
  ).value as Snapshot;
}

describe("native workspace protocol", () => {
  it("resolves an explicit environment override without repurposing the user's home", () => {
    vi.stubEnv("OTTER_CONFIG_DIR", undefined);
    expect(workspaceConfigDirectory([])).toBe(join(homedir(), ".config/otter"));
    vi.stubEnv("OTTER_CONFIG_DIR", config);
    expect(workspaceConfigDirectory([])).toBe(config);
    expect(workspaceConfigDirectory(["--config-dir", snapshots])).toBe(snapshots);
  });

  it("supports an unsaved local scan and diagnoses incomplete snapshot requests", async () => {
    const unsaved = await invoke([
      "scan",
      "--json",
      "--scan-root",
      home,
      "--collectors",
      "shell-config",
    ]);
    expect(unsaved.value.collectors[0].files[0].content).toContain("EDITOR=vim");
    expect(await new SnapshotStore(snapshots).list()).toEqual([]);
    const original = await scan();
    const requests = [
      ["snapshot", "show", "--json"],
      ["snapshot", "diff", original.id, "--json"],
      ["snapshot", "diff", original.id, "missing", "--json"],
      ["snapshot", "remove", original.id, "--json"],
      ["capabilities", "--json", "--job-id", "x".repeat(129)],
    ];
    for (const result of await Promise.all(requests.map(invoke))) {
      expect(result.code).toBe(1);
      expect(result.value.error.message).toBeTruthy();
    }
    expect((await new SnapshotStore(snapshots).load(original.id))?.id).toBe(original.id);
    expect((await invoke(["config", "--json"])).value.authenticated).toBe(false);
  });

  it("preserves same-second snapshots with colliding short IDs and refuses an ambiguous lookup", async () => {
    const original = await scan();
    const other = structuredClone(original);
    other.id = `${original.id.slice(0, 8)}-0000-4000-8000-000000000000`;
    await new SnapshotStore(snapshots).save(other);
    const result = await invoke(["snapshot", "show", original.id.slice(0, 8), "--json"]);
    expect(result.code).toBe(1);
    expect(result.value.error.message).toContain("Ambiguous");
    expect((await new SnapshotStore(snapshots).load(original.id))?.id).toBe(original.id);
    expect((await new SnapshotStore(snapshots).load(other.id))?.id).toBe(other.id);
  });

  it("returns ordered NDJSON errors for unauthenticated uploads and redacts failed-server diagnostics", async () => {
    const original = await scan();
    const call = async (api: string) => {
      let stdout = "";
      const code = await runWorkspaceCommand(
        [
          "backup",
          "--snapshot",
          original.id,
          "--format",
          "ndjson",
          "--job-id",
          "failure-job",
          "--api-url",
          api,
          "--config-dir",
          config,
          "--output-dir",
          snapshots,
        ],
        "test",
        {
          stdout: (value) => {
            stdout += value;
          },
          stderr: (value) => {
            expect(value).toBe("");
          },
        },
      );
      return {
        code,
        stdout,
        events: stdout
          .trim()
          .split("\n")
          .map((line) => JSON.parse(line)),
      };
    };
    const unauthenticated = await call("http://127.0.0.1:1");
    expect(unauthenticated.code).toBe(1);
    expect(unauthenticated.events.map((e) => e.type)).toEqual(["started", "error"]);
    expect(unauthenticated.events[1].data.message).toContain("Not logged in");
    const secret = "arbitrary-fixture-token-without-prefix";
    await writeFile(join(config, "config.json"), JSON.stringify({ token: secret }));
    server = createServer((_request, response) => {
      response.writeHead(503, `Rejected ${secret}`);
      response.end();
    });
    await new Promise<void>((resolve) => server?.listen(0, "127.0.0.1", resolve));
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("Missing server port");
    const rejected = await call(`http://127.0.0.1:${address.port}`);
    expect(rejected.code).toBe(1);
    expect(rejected.events.map((e) => e.type)).toEqual(["started", "progress", "error"]);
    expect(rejected.events.map((e) => e.sequence)).toEqual([0, 1, 2]);
    expect(rejected.stdout).not.toContain(secret);
    expect(rejected.events[2].data.message).toContain("[REDACTED]");
  });

  it("recognizes equals-form structured flags and explicit config paths", async () => {
    expect(workspaceConfigDirectory([`--config-dir=${config}`])).toBe(config);
    let stdout = "";
    const code = await runWorkspaceCommand(
      ["snapshot", "list", "--format=json", `--config-dir=${config}`],
      "test-version",
      {
        stdout: (value) => {
          stdout += value;
        },
        stderr: (value) => {
          expect(value).toBe("");
        },
      },
    );
    expect(code).toBe(0);
    expect(JSON.parse(stdout)).toEqual([]);
  });

  it("reports compatible capabilities and actual resolved paths without credentials", async () => {
    await writeFile(join(config, "config.json"), JSON.stringify({ token: "otk_fixture_only" }));
    const capabilities = await invoke(["capabilities", "--json"]);
    expect(capabilities.code).toBe(0);
    expect(capabilities.value).toMatchObject({
      protocolVersion: 1,
      cliVersion: "test-version",
      paths: { configPath: join(config, "config.json"), outputDir: snapshots },
    });
    expect(capabilities.value.operations).toContain("backup.snapshot");
    const status = await invoke([
      "config",
      "show",
      "--json",
      "--redact",
      "--api-url",
      "http://127.0.0.1:12345",
    ]);
    expect(status.value).toMatchObject({ authenticated: true, apiUrl: "http://127.0.0.1:12345" });
    expect(status.stdout + status.stderr).not.toContain("otk_fixture_only");
    expect((await invoke(["config", "status", "--json", "--dev"])).value.authenticated).toBe(false);
  });

  it("scan stdout is one JSON object and explicit roots isolate file collection", async () => {
    const result = await invoke([
      "scan",
      "--json",
      "--save",
      "--scan-root",
      home,
      "--collectors",
      "shell-config,hermes",
    ]);
    expect(result.code).toBe(0);
    expect(result.stderr).toContain("Scanning");
    expect(result.stdout).not.toContain("Scanning");
    expect(result.value.machine.homeDir).toBe(home);
    expect(result.value.collectors.map((c: { id: string }) => c.id)).toEqual([
      "shell-config",
      "hermes",
    ]);
    const hermes = result.value.collectors[1];
    expect(hermes.lists.map((l: { name: string }) => l.name)).toEqual(
      expect.arrayContaining(["default/linked", "default/category/nested"]),
    );
    const list = await invoke(["snapshot", "list", "--json"]);
    expect(list.value).toHaveLength(1);
    expect((await stat(join(snapshots, list.value[0].filename))).mode & 0o777).toBe(0o600);
    const show = await invoke(["snapshot", "show", result.value.id, "--json"]);
    expect(show.value.snapshot).toEqual(result.value);
    expect(show.value.sha256).toBe(snapshotDigest(result.value));
  });

  it("streams ordered job events with collector results and a final persisted snapshot", async () => {
    let stdout = "";
    const code = await runWorkspaceCommand(
      [
        "scan",
        "--save",
        "--format",
        "ndjson",
        "--job-id",
        "test-job",
        "--config-dir",
        config,
        "--output-dir",
        snapshots,
        "--scan-root",
        home,
        "--collectors",
        "hermes",
      ],
      "test",
      {
        stdout: (s) => {
          stdout += s;
        },
        stderr: () => {
          /* NDJSON progress is carried by stdout. */
        },
      },
    );
    const events = stdout
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line));
    expect(code).toBe(0);
    expect(events.map((e) => e.sequence)).toEqual([0, 1, 2, 3]);
    expect(events.map((e) => e.type)).toEqual(["started", "progress", "progress", "result"]);
    expect(events.every((e) => e.protocolVersion === 1 && e.jobId === "test-job")).toBe(true);
    const saved = events[3].data;
    expect(JSON.parse(await readFile(join(snapshots, saved.filename), "utf8"))).toEqual(
      saved.snapshot,
    );
  });

  it("uploads the exact reviewed object via gzip, never rescans or adds icon uploads", async () => {
    const original = await scan();
    await writeFile(join(config, "config.json"), JSON.stringify({ token: "otk_fixture_only" }));
    await writeFile(join(home, ".zshrc"), "CHANGED AFTER REVIEW\n");
    const requests: {
      path: string;
      token: string | undefined;
      digest: string;
      snapshot: Snapshot;
    }[] = [];
    server = createServer(async (request, response) => {
      const chunks = [];
      for await (const chunk of request) chunks.push(chunk);
      const body = gunzipSync(Buffer.concat(chunks));
      requests.push({
        path: request.url ?? "",
        token: request.headers.authorization,
        digest: createHash("sha256").update(body).digest("hex"),
        snapshot: JSON.parse(body.toString()),
      });
      response.writeHead(200, { "content-type": "application/json" });
      response.end("{}");
    });
    await new Promise<void>((resolve) => server?.listen(0, "127.0.0.1", resolve));
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("Missing test server port");
    const result = await invoke([
      "backup",
      "--json",
      "--snapshot",
      original.id,
      "--snapshot-sha256",
      snapshotDigest(original),
      "--api-url",
      `http://127.0.0.1:${address.port}`,
    ]);
    expect(result.code).toBe(0);
    expect(requests).toHaveLength(1);
    expect(requests[0]).toMatchObject({
      path: "/api/snapshots",
      token: "Bearer otk_fixture_only",
      digest: snapshotDigest(original),
      snapshot: original,
    });
    expect(result.stdout + result.stderr).not.toContain("otk_fixture_only");
  });

  it("refuses a snapshot changed after review before making a network request", async () => {
    const original = await scan();
    const hash = snapshotDigest(original);
    original.collectors[0].files[0].content = "tampered";
    const savedMeta = (await new SnapshotStore(snapshots).list())[0];
    await writeFile(join(snapshots, savedMeta.filename), JSON.stringify(original));
    const result = await invoke([
      "backup",
      "--snapshot",
      original.id,
      "--snapshot-sha256",
      hash,
      "--api-url",
      "http://127.0.0.1:1",
    ]);
    expect(result.code).toBe(1);
    expect(result.value.error.message).toContain("changed since review");
  });

  it("diff finds equal-length content edits, versions and metadata changes", async () => {
    const original = await scan();
    await writeFile(join(home, ".zshrc"), "export EDITOR=zed\n");
    const updated = await scan();
    const result = await invoke(["snapshot", "diff", original.id, updated.id, "--json"]);
    expect(
      result.value.collectors.find((c: { collectorId: string }) => c.collectorId === "shell-config")
        .files,
    ).toContainEqual({ type: "changed", label: join(home, ".zshrc") });
    original.collectors[0].lists = [{ name: "tool", version: "1.0", meta: { channel: "stable" } }];
    updated.collectors[0].lists = [{ name: "tool", version: "1.1", meta: { channel: "stable" } }];
    expect(diffSnapshots(original, updated).collectors[0].lists).toEqual([
      { type: "changed", label: "tool" },
    ]);
    updated.collectors[0].lists = [{ name: "tool", version: "1.0", meta: { channel: "preview" } }];
    expect(diffSnapshots(original, updated).collectors[0].lists).toEqual([
      { type: "changed", label: "tool" },
    ]);
  });

  it.each([
    ["scan", "--json", "--scan-root", "relative"],
    ["scan", "--json", "--scan-root", "FIXTURE"],
    ["scan", "--json", "--scan-root", "FIXTURE", "--collectors", "homebrew"],
    ["scan", "--json", "--collectors", "made-up"],
    ["snapshot", "show", "missing", "--json"],
    ["snapshot", "diff", "missing", "also-missing", "--json"],
    ["backup", "--json", "--scan-root", "FIXTURE", "--collectors", "shell-config"],
    ["backup", "--json", "--snapshot", "missing"],
    ["config", "get", "token", "--json"],
    ["unsupported", "--json"],
    ["capabilities", "--format", "yaml"],
    ["capabilities", "--json", "--bad"],
  ])("invalid structured requests fail explicitly: %j", async (...args) => {
    const result = await invoke(args.map((value) => (value === "FIXTURE" ? home : value)));
    expect(result.code).toBe(1);
    expect(result.value.error.message).toBeTruthy();
  });

  it("human commands and --help remain with the original CLI", async () => {
    expect(await runWorkspaceCommand(["scan", "--help"], "test")).toBeUndefined();
    expect(await runWorkspaceCommand(["config", "show"], "test")).toBeUndefined();
  });

  it.each([
    "http://example.com",
    "ftp://example.com",
    "https://u:secret@example.com",
    "https://example.com/path",
    "https://example.com?token=secret",
  ])("rejects unsafe API origin %s", (value) => {
    expect(() => validatedApiUrl(value)).toThrow();
  });
});
