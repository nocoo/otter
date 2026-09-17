// biome-ignore-all lint/performance/noAwaitInLoops: deterministic bounded root discovery with profile-local configuration
import { execFile } from "node:child_process";
import { constants } from "node:fs";
import { access, lstat, readdir } from "node:fs/promises";
import { basename, dirname, join, resolve } from "node:path";
import { promisify } from "node:util";
import type { AgentInstallation, AgentKind, CoverageIssue, WorkspaceRegistry } from "@otter/core";
import { type ParseError, parse as parseJsonc } from "jsonc-parser";
import { parse as parseToml } from "smol-toml";
import { parse as parseYaml } from "yaml";
import { type CapturePlan, digest, readStableFile, resolvePath, within } from "./files.js";

const exec = promisify(execFile);
const GLOBAL_FILES = [
  "AGENTS.md",
  "AGENTS.override.md",
  "CLAUDE.md",
  "GEMINI.md",
  "instructions.md",
  "SOUL.md",
  "MEMORY.md",
  "USER.md",
];
const AGENT_FILES = [
  ...GLOBAL_FILES,
  "config.toml",
  "config.yaml",
  "settings.json",
  "settings.local.json",
  "opencode.json",
  "opencode.jsonc",
  "mcp.json",
  "skills",
  "commands",
  "prompts",
  "rules",
  "hooks",
  "agents",
  "extensions",
  "memories",
  "cron/jobs.json",
];
const AGENTS: [AgentKind, string][] = [
  ["claude", ".claude"],
  ["codex", ".codex"],
  ["grok", ".grok"],
  ["pi", ".pi/agent"],
  ["opencode", ".config/opencode"],
  ["gemini", ".gemini"],
  ["hermes", ".hermes"],
];
const expand = (path: string, home: string, base: string) =>
  path.startsWith("~/") ? join(home, path.slice(2)) : resolve(base, path);
async function exists(path: string): Promise<boolean> {
  try {
    await lstat(path);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code !== "ENOENT";
  }
}
async function configurationText(path: string): Promise<string> {
  const resolved = await resolvePath(path);
  if (resolved.error) throw new Error(resolved.error);
  return (await readStableFile(resolved.finalPath, 1024 * 1024)).toString("utf8");
}
async function installation(
  kind: AgentKind,
  home: string,
): Promise<{ executable?: string; version?: string }> {
  const paths = [
    ...(process.env.PATH ?? "").split(":"),
    "/opt/homebrew/bin",
    "/usr/local/bin",
    join(home, ".local/bin"),
    join(home, ".bun/bin"),
    join(home, ".grok/bin"),
    join(home, ".hermes/venv/bin"),
  ];
  for (const directory of [...new Set(paths)].filter((p) => p.startsWith("/"))) {
    const executable = join(directory, kind);
    try {
      await access(executable, constants.X_OK);
    } catch {
      continue;
    }
    try {
      const { stdout } = await exec(executable, ["--version"], { timeout: 3000, maxBuffer: 8192 });
      return { executable, version: stdout.trim().slice(0, 200) };
    } catch {
      return { executable };
    }
  }
  return {};
}

const CONFIG_FILES: Partial<Record<AgentKind, string>> = {
  hermes: "config.yaml",
  codex: "config.toml",
  grok: "config.toml",
};
const PROJECT_FILES: Record<AgentKind, string[]> = {
  claude: ["CLAUDE.md", ".claude"],
  codex: ["AGENTS.md", "AGENTS.override.md", ".codex", ".agents"],
  grok: ["AGENTS.md", ".grok"],
  pi: ["AGENTS.md", ".pi", ".agents"],
  opencode: ["AGENTS.md", ".opencode", ".agents"],
  gemini: ["GEMINI.md", ".gemini"],
  hermes: [],
};
async function parseConfiguration(path: string): Promise<Record<string, unknown>> {
  const text = await configurationText(path);
  const errors: ParseError[] = [];
  const value: unknown = path.endsWith(".yaml")
    ? parseYaml(text, { maxAliasCount: 50 })
    : path.endsWith(".toml")
      ? parseToml(text)
      : parseJsonc(text, errors);
  if (!value || typeof value !== "object" || Array.isArray(value) || errors.length)
    throw new Error("Configuration is not an object");
  return value as Record<string, unknown>;
}

export async function discoverWorkspace(
  home: string,
  registry: WorkspaceRegistry,
  inspectExecutables: boolean,
): Promise<{ plans: CapturePlan[]; agents: AgentInstallation[]; issues: CoverageIssue[] }> {
  const plans: CapturePlan[] = [],
    agents: AgentInstallation[] = [],
    issues: CoverageIssue[] = [];
  let grokSkills = true,
    grokInstructions = true;
  const disabledCodex: string[] = [];
  const add = (
    id: string,
    path: string,
    role: CapturePlan["root"]["role"],
    agentIds: string[],
    include?: string[],
    skillRoot?: boolean,
  ) => {
    const plan: CapturePlan = {
      root: { id, path, role, label: basename(path), agentIds, status: "complete" },
      ...(include ? { include } : {}),
      ...(skillRoot ? { skillRoot } : {}),
    };
    plans.push(plan);
    return plan;
  };

  async function profilesFor(kind: AgentKind, mainPath: string): Promise<[string, string][]> {
    const profiles: [string, string][] = [["default", mainPath]];
    if (kind !== "hermes") return profiles;
    try {
      for (const profile of (await readdir(join(mainPath, "profiles"))).sort()) {
        const path = join(mainPath, "profiles", profile),
          target = await resolvePath(path);
        if (target.error || (await lstat(target.finalPath)).isDirectory())
          profiles.push([profile, path]);
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT")
        issues.push({
          rootId: "hermes:default",
          path: join(mainPath, "profiles"),
          status: "error",
          reason: "Cannot enumerate Hermes profiles",
        });
    }
    return profiles;
  }

  async function codexReferences(
    config: Record<string, unknown>,
    id: string,
    configPath: string,
  ): Promise<void> {
    if (typeof config.model_instructions_file === "string") {
      const path = expand(config.model_instructions_file, home, configPath);
      add(`${id}:instructions`, dirname(path), "external", [id], [basename(path)]);
    }
    const skills = config.skills as { config?: { path?: string; enabled?: boolean }[] } | undefined;
    for (const [i, item] of (skills?.config ?? []).entries()) {
      if (typeof item.path !== "string") continue;
      const path = expand(item.path, home, home);
      if (item.enabled === false) disabledCodex.push((await resolvePath(path)).finalPath);
      add(
        `${id}:configured:${i}`,
        path.endsWith("SKILL.md") ? dirname(path) : path,
        "external",
        [id],
        undefined,
        true,
      );
    }
  }

  async function references(kind: AgentKind, configPath: string, id: string): Promise<void> {
    const configFile = join(configPath, CONFIG_FILES[kind] ?? "settings.json");
    if (!(await exists(configFile))) return;
    try {
      const config = await parseConfiguration(configFile);
      if (kind === "grok") {
        const compatibility = (
          config.compat as { claude?: { skills?: boolean; agents?: boolean } } | undefined
        )?.claude;
        grokSkills = compatibility?.skills !== false;
        grokInstructions = compatibility?.agents !== false;
      }
      if (kind === "hermes") hermesReferences(config, id, configPath);
      if (kind === "codex") await codexReferences(config, id, configPath);
    } catch {
      issues.push({
        rootId: id,
        path: configFile,
        status: "error",
        reason:
          "Cannot discover configuration references: check syntax, regular-file access and the 1 MiB read limit",
      });
    }
  }
  function hermesReferences(config: Record<string, unknown>, id: string, configPath: string): void {
    const directories = (config.skills as Record<string, unknown> | undefined)?.external_dirs;
    if (directories === undefined) return;
    if (!Array.isArray(directories) || directories.some((path) => typeof path !== "string"))
      throw new Error("skills.external_dirs must be a list of paths");
    for (const [i, external] of directories.entries())
      add(
        `${id}:external:${i}`,
        expand(external as string, home, configPath),
        "external",
        [id],
        undefined,
        true,
      );
  }

  async function discoverAgent(kind: AgentKind, folder: string): Promise<void> {
    const mainPath = join(home, folder);
    const binary = inspectExecutables ? await installation(kind, home) : {};
    for (const [profile, configPath] of await profilesFor(kind, mainPath)) {
      const present = await exists(configPath);
      if (!present && !binary.executable) continue;
      const id = `${kind}:${profile === "default" && configPath !== mainPath ? "profile:default" : profile}`;
      agents.push({ id, kind, profile, configPath, ...binary, discovery: "on-disk" });
      if (!present) continue;
      add(id, configPath, "agent", [id], AGENT_FILES);
      await references(kind, configPath, id);
    }
  }

  async function discoverShared(): Promise<void> {
    if (await exists(join(home, ".agents")))
      add(
        "shared:agents",
        join(home, ".agents"),
        "shared",
        agents
          .filter(
            (agent) =>
              ["codex", "pi", "opencode"].includes(agent.kind) ||
              (agent.kind === "grok" && grokSkills),
          )
          .map((agent) => agent.id),
        ["skills", "rules", "commands", ...GLOBAL_FILES],
      );
    if (await exists(join(home, ".claude.json"))) {
      if (!agents.some((agent) => agent.id === "claude:default"))
        agents.push({
          id: "claude:default",
          kind: "claude",
          profile: "default",
          configPath: join(home, ".claude"),
          discovery: "on-disk",
        });
      add("claude:home", home, "external", ["claude:default"], [".claude.json"]);
    }
  }
  function configureGrok(): void {
    const claude = plans.find((plan) => plan.root.id === "claude:default");
    if (!claude || !agents.some((agent) => agent.kind === "grok")) return;
    const include = [
      ...(grokSkills ? ["skills", "commands"] : []),
      ...(grokInstructions ? ["CLAUDE.md"] : []),
    ];
    claude.consumers = [
      { agentId: "claude:default" },
      ...(include.length ? [{ agentId: "grok:default", include }] : []),
    ];
    claude.root.agentIds = claude.consumers.map((consumer) => consumer.agentId);
  }

  async function discoverPlugins(): Promise<void> {
    // The registry references immutable installations outside skills/.
    const pluginsPath = join(home, ".claude/plugins/installed_plugins.json");
    if (!(await exists(pluginsPath))) return;
    add(
      "claude:plugins",
      dirname(pluginsPath),
      "external",
      ["claude:default"],
      [basename(pluginsPath), "known_marketplaces.json"],
    );
    try {
      const data = JSON.parse(await configurationText(pluginsPath)) as {
        plugins?: Record<string, { installPath?: string }[]>;
      };
      for (const [name, installs] of Object.entries(data.plugins ?? {}))
        for (const [i, plugin] of installs.entries()) {
          if (!plugin.installPath) continue;
          add(
            `claude:plugin:${digest(name).slice(0, 16)}:${i}`,
            expand(plugin.installPath, home, dirname(pluginsPath)),
            "external",
            ["claude:default"],
            ["skills", "commands", "agents", "hooks", ".claude-plugin", ...GLOBAL_FILES],
          );
        }
    } catch {
      issues.push({
        rootId: "claude:plugins",
        path: pluginsPath,
        status: "error",
        reason: "Cannot parse installed plugin locations",
      });
    }
  }

  function discoverProjects(): void {
    const consumers: NonNullable<CapturePlan["consumers"]> = agents
      .map((agent) => {
        const include = [...PROJECT_FILES[agent.kind]];
        if (agent.kind === "grok" && grokSkills) include.push(".agents");
        if (agent.kind === "grok" && grokInstructions) include.push("CLAUDE.md");
        return { agentId: agent.id, include };
      })
      .filter((consumer) => consumer.include.length);
    for (const project of registry.projects) {
      let path = project,
        depth = 0;
      while (path !== "/" && path !== home && depth < 24) {
        const include = [...GLOBAL_FILES];
        if (path === project)
          include.push(
            ...[".claude", ".codex", ".grok", ".gemini", ".agents", ".pi", ".opencode"].flatMap(
              (folder) => AGENT_FILES.map((file) => `${folder}/${file}`),
            ),
          );
        const plan = add(
          `project:${digest(project).slice(0, 16)}:${digest(path).slice(0, 16)}`,
          path,
          "project",
          consumers.map((consumer) => consumer.agentId),
          include,
        );
        plan.root.cwd = project;
        plan.consumers = consumers;
        path = dirname(path);
        depth++;
      }
      if (depth === 24)
        issues.push({
          rootId: `project:${digest(project).slice(0, 16)}`,
          path,
          status: "limit",
          reason: "Project ancestor discovery reached its depth limit",
        });
    }
  }

  function discoverBindings(): void {
    // Editing bindings can refer outside the standard roots and must still be recoverable.
    for (const path of new Set(
      registry.bindings.flatMap((binding) => [binding.source, binding.target]),
    )) {
      const covered = plans.some(
        (plan) =>
          within(path, plan.root.path) &&
          (!plan.include ||
            plan.include.some((entry) => within(path, join(plan.root.path, entry)))),
      );
      if (!covered) add(`binding:${digest(path).slice(0, 16)}`, path, "external", []);
    }
  }

  for (const source of registry.sources) add(source.id, source.path, "source", []);
  for (const [kind, folder] of AGENTS) await discoverAgent(kind, folder);
  await discoverShared();
  configureGrok();
  await discoverPlugins();
  discoverProjects();
  discoverBindings();
  for (const plan of plans) {
    plan.consumers ??= plan.root.agentIds.map((agentId) => ({ agentId }));
    for (const consumer of plan.consumers)
      if (consumer.agentId === "codex:default") {
        consumer.disabledPaths = disabledCodex;
        consumer.legacyPaths = [join(home, ".codex/prompts"), join(home, ".codex/instructions.md")];
      }
  }
  return { plans, agents, issues };
}
