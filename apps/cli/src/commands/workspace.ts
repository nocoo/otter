/** Versioned, non-interactive CLI interface used by the native workspace. */
import { createHash, randomUUID } from "node:crypto";
import { homedir } from "node:os";
import { isAbsolute, join, resolve } from "node:path";
import { parseArgs } from "node:util";
import type { Collector, Snapshot } from "@otter/core";
import { createDefaultCollectors } from "../collectors/index.js";
import { ConfigManager } from "../config/manager.js";
import { exportSnapshot } from "../snapshot/export.js";
import { SnapshotStore } from "../storage/local.js";
import { RemoteStore } from "../storage/remote.js";
import { observeGit } from "../workspace/git.js";
import {
  addSource,
  editRegistry,
  importWorkspace,
  readRegistry,
  syncWorkspace,
} from "../workspace/registry.js";
import { buildApiBaseUrl, executeLogin, resolveHost } from "./login.js";
import { executeScan } from "./scan.js";
import { diffSnapshots } from "./snapshot.js";
import { backupState, backupTimeline } from "./workspace-state.js";

export const WORKSPACE_PROTOCOL = 1;
const FILE_COLLECTORS = new Set([
  "agent-workspace",
  "claude-config",
  "opencode-config",
  "shell-config",
  "hermes",
]);
const TOKEN_PATTERN = /(?:otk_|Bearer\s+)[A-Za-z0-9_.-]+/gi;
const FLAGS = {
  json: { type: "boolean" },
  format: { type: "string" },
  dev: { type: "boolean" },
  redact: { type: "boolean" },
  slim: { type: "boolean" },
  save: { type: "boolean" },
  "config-dir": { type: "string" },
  "scan-root": { type: "string" },
  "output-dir": { type: "string" },
  "api-url": { type: "string" },
  "job-id": { type: "string" },
  collectors: { type: "string" },
  snapshot: { type: "string" },
  "snapshot-sha256": { type: "string" },
  "workspace-file": { type: "string" },
  destination: { type: "string" },
} as const;

interface WorkspaceIo {
  stdout: (text: string) => void;
  stderr: (text: string) => void;
}

export function snapshotDigest(snapshot: Snapshot): string {
  return createHash("sha256").update(JSON.stringify(snapshot)).digest("hex");
}

export function workspaceConfigDirectory(argv = process.argv.slice(2)): string {
  const index = argv.indexOf("--config-dir");
  return resolve(
    (index >= 0
      ? argv[index + 1]
      : argv.find((arg) => arg.startsWith("--config-dir="))?.slice(13)) ??
      process.env.OTTER_CONFIG_DIR ??
      join(homedir(), ".config", "otter"),
  );
}

function absoluteOption(value: string | undefined, fallback: string): string {
  if (value && !isAbsolute(value)) throw new Error("Directory arguments must be absolute paths");
  return value ?? fallback;
}

export function validatedApiUrl(value: string): string {
  const url = new URL(value);
  if (url.username || url.password || url.search || url.hash || url.pathname !== "/") {
    throw new Error("API URL must be an origin without credentials, path, query or fragment");
  }
  if (
    url.protocol !== "https:" &&
    !(url.protocol === "http:" && ["127.0.0.1", "localhost", "[::1]"].includes(url.hostname))
  ) {
    throw new Error("API URL must use HTTPS (HTTP is allowed only on loopback)");
  }
  return url.origin;
}

export function selectCollectors(
  root: string,
  selection: string | undefined,
  slim: boolean,
  configDirectory: string,
): Collector[] {
  const all = createDefaultCollectors(root, { slim, configDirectory });
  if (root !== homedir() && !selection) {
    throw new Error("An explicit --scan-root requires --collectors (file collectors only)");
  }
  if (!selection) return all;
  const ids = new Set(selection.split(","));
  if ([...ids].some((id) => !all.some((c) => c.id === id)))
    throw new Error("Unknown collector in --collectors");
  if (root !== homedir() && [...ids].some((id) => !FILE_COLLECTORS.has(id))) {
    throw new Error(
      "An isolated scan only supports agent-workspace, claude-config, opencode-config, shell-config and hermes",
    );
  }
  return all.filter((c) => ids.has(c.id));
}

/** Undefined means this is a human-facing command handled by the regular CLI. */
// biome-ignore lint/complexity/noExcessiveCognitiveComplexity: versioned command dispatch shares protocol setup and a single redacted error boundary
export async function runWorkspaceCommand(
  argv: string[],
  version: string,
  io: WorkspaceIo = {
    stdout: (s) => process.stdout.write(s),
    stderr: (s) => process.stderr.write(s),
  },
): Promise<number | undefined> {
  if (argv.includes("--help") || argv.includes("-h")) return undefined;
  const flags = new Set(argv.map((arg) => arg.split("=", 1)[0]));
  if (
    !["capabilities", "source", "workspace"].includes(argv[0] ?? "") &&
    !(
      argv[0] === "snapshot" && ["timeline", "verify", "download", "export"].includes(argv[1] ?? "")
    ) &&
    !flags.has("--json") &&
    !flags.has("--format") &&
    !flags.has("--snapshot") &&
    !flags.has("--scan-root") &&
    !flags.has("--output-dir") &&
    !flags.has("--api-url")
  )
    return undefined;

  let sequence = 0;
  let ndjson = false;
  let jobId = randomUUID() as string;
  let secret: string | undefined;
  const emit = (type: string, data: unknown) =>
    io.stdout(
      `${JSON.stringify({
        protocolVersion: WORKSPACE_PROTOCOL,
        jobId,
        sequence: sequence++,
        type,
        data,
      })}\n`,
    );
  try {
    const { values, positionals } = parseArgs({
      args: argv,
      options: FLAGS,
      allowPositionals: true,
      strict: true,
    });
    if (values.format && !["json", "ndjson"].includes(values.format))
      throw new Error("Supported formats: json, ndjson");
    ndjson = values.format === "ndjson";
    jobId = values["job-id"] ?? jobId;
    if (jobId.length > 128) throw new Error("job-id exceeds 128 characters");
    const configDir = absoluteOption(values["config-dir"], workspaceConfigDirectory(argv));
    const scanRoot = absoluteOption(values["scan-root"], homedir());
    const outputDir = absoluteOption(values["output-dir"], join(configDir, "snapshots"));
    const apiUrl = validatedApiUrl(values["api-url"] ?? buildApiBaseUrl());
    const config = new ConfigManager(configDir, values.dev ?? false);
    const store = new SnapshotStore(outputDir);
    const command = positionals[0];
    const action = positionals[1];
    if (ndjson) emit("started", { command, scanRoot, configPath: config.configPath, apiUrl });
    let result: unknown;

    switch (command) {
      case "capabilities":
        result = {
          protocolVersion: WORKSPACE_PROTOCOL,
          cliVersion: version,
          snapshotVersions: [1, 2],
          workspaceSchemaVersion: 2,
          platform: process.platform,
          arch: process.arch,
          operations: [
            "scan",
            "snapshot.list",
            "snapshot.show",
            "snapshot.diff",
            "backup.snapshot",
            "config.status",
            "login",
            "workspace.inspect",
            "source.list",
            "source.add",
            "source.remove",
            "source.fetch",
            "source.import",
            "source.apply",
            "snapshot.timeline",
            "snapshot.verify",
            "snapshot.download",
            "snapshot.export",
          ],
          formats: ["json", "ndjson"],
          paths: { scanRoot, configPath: config.configPath, outputDir },
          apiUrl,
        };
        break;
      case "config": {
        if (action && !["show", "status"].includes(action))
          throw new Error("Structured config supports show/status only");
        const loaded = await config.load();
        result = {
          protocolVersion: WORKSPACE_PROTOCOL,
          authenticated: !!loaded.token,
          configPath: config.configPath,
          apiUrl,
          webUrl: resolveHost({ dev: values.dev ?? false }),
          environment: values.dev ? "development" : "production",
          outputDir,
        };
        break;
      }
      case "source": {
        if (!action || action === "list") result = await readRegistry(configDir);
        else if (action === "import" && values["workspace-file"])
          result = await importWorkspace(configDir, values["workspace-file"]);
        else if (action === "apply" && values["workspace-file"])
          result = await syncWorkspace(configDir, values["workspace-file"]);
        else if (action === "add" && positionals[2])
          result = await editRegistry(configDir, (registry) =>
            addSource(registry, positionals[2] as string),
          );
        else if (action === "remove" && positionals[2])
          result = await editRegistry(configDir, (registry) => {
            registry.sources = registry.sources.filter(
              (s) => s.id !== positionals[2] && s.path !== positionals[2],
            );
          });
        else if (action === "fetch" && positionals[2]) {
          const source = (await readRegistry(configDir)).sources.find(
            (s) => s.id === positionals[2] || s.path === positionals[2],
          );
          if (!source) throw new Error("Registered source not found");
          result = await observeGit(source.path, configDir, source.id, true);
        } else
          throw new Error(
            "Use source list/add <absolute-folder>/remove <id>/fetch <id>/import --workspace-file <path>",
          );
        break;
      }
      case "workspace":
      case "scan": {
        if (command === "workspace" && action !== "inspect")
          throw new Error("Use workspace inspect");
        const snapshot = await executeScan(
          selectCollectors(
            scanRoot,
            command === "workspace" ? "agent-workspace" : values.collectors,
            values.slim ?? false,
            configDir,
          ),
          {
            homeDir: scanRoot,
            onStart: (id, label) => {
              if (ndjson) emit("progress", { collectorId: id, label, phase: "started" });
              else io.stderr(`Scanning ${label}\n`);
            },
            onProgress: (id, r) => {
              if (ndjson)
                emit("progress", {
                  collectorId: id,
                  phase: "completed",
                  files: r.files.length,
                  items: r.lists.length,
                  errors: r.errors,
                  skipped: r.skipped,
                });
            },
          },
        );
        snapshot.machine.homeDir = scanRoot;
        if (command === "workspace") {
          result = { workspace: snapshot.workspace, backup: await backupState(snapshot, store) };
          break;
        }
        const filename = values.save ? await store.save(snapshot) : undefined;
        result = ndjson ? { snapshot, filename, sha256: snapshotDigest(snapshot) } : snapshot;
        break;
      }
      case "snapshot": {
        if (action === "list") {
          result = await store.list();
          break;
        }
        if (action === "timeline") {
          secret = (await config.load()).token;
          result = await backupTimeline(store, configDir, apiUrl, secret);
          break;
        }
        if (action === "download") {
          secret = (await config.load()).token;
          if (!secret || !positionals[2])
            throw new Error("Log in and specify a remote snapshot ID");
          result = await new RemoteStore(configDir, apiUrl, secret).download(positionals[2], store);
          break;
        }
        const first = positionals[2] ? await store.load(positionals[2]) : null;
        if (!first)
          throw new Error("Snapshot not found (use a full ID or unique eight-character ID)");
        if (action === "show") {
          result = { snapshot: first, sha256: snapshotDigest(first) };
          break;
        }
        if (action === "export") {
          if (!values.destination)
            throw new Error("Export requires --destination <new absolute directory>");
          result = await exportSnapshot(first, values.destination);
          break;
        }
        if (action === "verify") {
          secret = (await config.load()).token;
          if (!secret) throw new Error("Not logged in. Run otter login first");
          result = await new RemoteStore(configDir, apiUrl, secret).verify(first);
          break;
        }
        if (action !== "diff") throw new Error("Unknown snapshot action");
        const second = positionals[3] ? await store.load(positionals[3]) : null;
        if (!second) throw new Error("Comparison snapshot not found");
        result = diffSnapshots(first, second);
        break;
      }
      case "backup": {
        const snapshot = values.snapshot
          ? await store.load(values.snapshot)
          : await executeScan(
              selectCollectors(scanRoot, values.collectors, values.slim ?? false, configDir),
              { homeDir: scanRoot },
            );
        if (!snapshot) throw new Error("Reviewed snapshot not found");
        const sha256 = snapshotDigest(snapshot);
        if (values["snapshot-sha256"] && sha256 !== values["snapshot-sha256"])
          throw new Error("Snapshot changed since review; inspect it again before uploading");
        if (!values.snapshot) await store.save(snapshot);
        const loaded = await config.load();
        secret = loaded.token;
        if (!secret)
          throw new Error(
            `Not logged in. Snapshot ${snapshot.id} is saved locally; run otter login, then backup --snapshot ${snapshot.id}`,
          );
        if (ndjson)
          emit("progress", { phase: "uploading", snapshotId: snapshot.id, sha256, apiUrl });
        const uploaded = await new RemoteStore(configDir, apiUrl, secret).upload(snapshot);
        if (!uploaded.success)
          throw new Error(uploaded.error ?? "Upload failed; server acceptance is unconfirmed");
        result = {
          snapshotId: snapshot.id,
          sha256,
          apiUrl,
          uploaded: true,
          receipt: uploaded.receipt,
        };
        break;
      }
      case "login": {
        const login = await executeLogin(
          config,
          { dev: values.dev ?? false },
          {
            onBrowserOpen: () => {
              if (ndjson) emit("progress", { phase: "awaitingBrowser" });
            },
          },
        );
        if (!login.success) throw new Error(login.error ?? "Login failed");
        result = { authenticated: true, configPath: config.configPath, webUrl: login.host };
        break;
      }
      default:
        throw new Error("Unsupported structured command");
    }
    if (ndjson) emit("result", result);
    else io.stdout(`${JSON.stringify(result)}\n`);
    return 0;
  } catch (error) {
    let message = error instanceof Error ? error.message : String(error);
    if (secret) message = message.replaceAll(secret, "[REDACTED]");
    message = message.replace(TOKEN_PATTERN, "[REDACTED]");
    if (ndjson) emit("error", { message });
    else
      io.stdout(`${JSON.stringify({ protocolVersion: WORKSPACE_PROTOCOL, error: { message } })}\n`);
    return 1;
  }
}
