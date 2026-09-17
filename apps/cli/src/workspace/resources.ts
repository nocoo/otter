import { basename, dirname, join, relative } from "node:path";
import type { ResourceKind, WorkspaceRegistry, WorkspaceResource } from "@otter/core";
import { type CapturedFile, type CapturePlan, digest, within } from "./files.js";

const INSTRUCTION_NAME =
  /^(?:AGENTS(?:\.override)?|CLAUDE|GEMINI|SOUL|MEMORY|USER|instructions)\.md$/i;
const COMMAND_PATH = /(?:^|\/)(?:commands|prompts)\//;
const RULE_PATH = /(?:^|\/)rules\//;
const HOOK_PATH = /(?:^|\/)hooks\//;
const DISCOVERY_REASONS = {
  disabled: "Explicitly disabled in skills.config; contents are still backed up",
  unsupported: "Legacy entry; current runtime loading is not established",
  "project-only": undefined,
  "on-disk": undefined,
};
const SKILL_PATH = /(?:^|\/)(?:skills|command-skills)\/([^/]+)/;

function kindFor(path: string): ResourceKind {
  if (INSTRUCTION_NAME.test(basename(path))) return "instruction";
  if (COMMAND_PATH.test(path)) return "command";
  if (RULE_PATH.test(path)) return "rule";
  if (HOOK_PATH.test(path)) return "hook";
  return "configuration";
}
function resourceDiscovery(
  plan: CapturePlan,
  path: string,
  resolved: string,
): NonNullable<WorkspaceResource["discovery"]> {
  const consumers: NonNullable<CapturePlan["consumers"]> =
    plan.consumers ?? plan.root.agentIds.map((agentId) => ({ agentId }));
  return consumers
    .filter(
      (consumer) =>
        !consumer.include ||
        consumer.include.some((entry) => within(path, join(plan.root.path, entry))),
    )
    .map((consumer) => {
      const disabled = consumer.disabledPaths?.some(
        (target) => target === resolved || target === join(resolved, "SKILL.md"),
      );
      const legacy = consumer.legacyPaths?.some((target) => within(path, target));
      const state = disabled
        ? "disabled"
        : legacy
          ? "unsupported"
          : plan.root.cwd
            ? "project-only"
            : "on-disk";
      const reason = DISCOVERY_REASONS[state];
      return {
        agentId: consumer.agentId,
        state,
        ...(reason ? { reason } : {}),
        ...(plan.root.cwd ? { cwd: plan.root.cwd } : {}),
      };
    });
}
type ResourceGroup = { kind: ResourceKind; files: CapturedFile[] };
function packagePaths(plan: CapturePlan, entries: CapturedFile[]): Set<string> {
  const { root, skillRoot } = plan;
  const packages = new Set(
    entries.filter((f) => basename(f.path) === "SKILL.md").map((f) => dirname(f.path)),
  );
  for (const entry of entries) {
    if ([...packages].some((p) => within(entry.path, p))) continue;
    const path = entry.relativePath;
    const candidate = SKILL_PATH.exec(path);
    const packagePath = candidate
      ? join(root.path, path.slice(0, candidate.index + candidate[0].length))
      : skillRoot && path !== "."
        ? join(root.path, path.split("/")[0] as string)
        : undefined;
    if (packagePath && ![...packages].some((p) => within(p, packagePath)))
      packages.add(packagePath);
  }
  return packages;
}
function groupEntries(plan: CapturePlan, entries: CapturedFile[]): Map<string, ResourceGroup> {
  const packages = packagePaths(plan, entries);
  const groups = new Map<string, { kind: ResourceKind; files: CapturedFile[] }>();
  for (const entry of entries) {
    const packagePath = [...packages]
      .filter((p) => within(entry.path, p))
      .sort((a, b) => b.length - a.length)[0];
    if (!packagePath && entry.kind === "directory") continue;
    const path = packagePath ?? entry.path;
    const group = groups.get(path) ?? {
      kind: packagePath ? "skill" : kindFor(entry.path),
      files: [],
    };
    group.files.push(entry);
    groups.set(path, group);
  }
  return groups;
}
function describeResource(
  plan: CapturePlan,
  path: string,
  group: ResourceGroup,
  originalHashes: Map<string, string>,
  editingDigests: Map<string, string>,
): WorkspaceResource {
  const { root } = plan;

  const first = group.files.find((f) => f.path === path) ?? (group.files[0] as CapturedFile);
  const suffix = relative(path, first.path);
  const resolvedPath = first.resolvedPath.slice(0, suffix ? -(suffix.length + 1) : undefined);
  const relativePath = relative(root.path, path) || ".";
  const hashed = group.files
    .filter((f) => f.path !== path || f.sha256)
    .map((f) => [relative(path, f.path), f.sha256 ?? "", f.mode, f.linkTarget ?? ""])
    .sort((a, b) => String(a[0]).localeCompare(String(b[0])));
  const nativeFiles = group.files.filter(
    (f) =>
      f.path !== path &&
      !group.files.some(
        (parent) =>
          parent.kind === "symlink" &&
          parent.path !== path &&
          parent.path !== f.path &&
          within(f.path, parent.path),
      ),
  );
  const nativeRecords = nativeFiles
    .sort((a, b) =>
      Buffer.compare(Buffer.from(relative(path, a.path)), Buffer.from(relative(path, b.path))),
    )
    .map(
      (f) =>
        `${relative(path, f.path)}\0${f.kind}\0${(f.entryMode ?? f.mode) & 0o111}\0${f.kind === "file" ? (originalHashes.get(f.path) ?? f.sha256 ?? "") : (f.linkTarget ?? "")}`,
    );
  editingDigests.set(
    path,
    group.kind === "skill"
      ? digest(nativeRecords.join("\0"))
      : (originalHashes.get(path) ?? first.sha256 ?? ""),
  );
  const discovery = resourceDiscovery(plan, path, resolvedPath);
  return {
    id: `${root.id}/${relativePath}`,
    rootId: root.id,
    relativePath,
    path,
    resolvedPath,
    name: basename(path),
    kind: group.kind,
    agentIds: discovery.map((c) => c.agentId),
    discovery,
    ...(root.role === "source" ? { sourceId: root.id } : {}),
    relationship:
      root.role === "source"
        ? "source"
        : group.files.some((f) => f.links.some((l) => within(l.path, root.entryPath ?? root.path)))
          ? "symlink"
          : root.role === "external"
            ? "configurationReference"
            : "independent",
    digest: group.kind === "skill" ? digest(JSON.stringify(hashed)) : (first.sha256 ?? ""),
    fileCount: group.files.filter((f) => !!f.sha256).length,
  };
}
function copyRelationship(
  resource: WorkspaceResource,
  source: WorkspaceResource,
  binding: WorkspaceRegistry["bindings"][number],
  editingDigests: Map<string, string>,
): WorkspaceResource["relationship"] {
  if (source.digest === resource.digest) return "managedCopy";
  if (
    source.digest === binding.baseSource ||
    editingDigests.get(source.path) === binding.baseSource
  )
    return "localChanged";
  if (
    resource.digest === binding.baseTarget ||
    editingDigests.get(resource.path) === binding.baseTarget
  )
    return "sourceChanged";
  return "bothChanged";
}
function relateResource(
  resource: WorkspaceResource,
  resources: WorkspaceResource[],
  originals: WorkspaceResource[],
  registry: WorkspaceRegistry,
  editingDigests: Map<string, string>,
): void {
  const linked = originals.find(
    (original) =>
      original.resolvedPath === resource.resolvedPath && original.kind === resource.kind,
  );
  if (linked) {
    resource.sourceId = linked.rootId;
    resource.counterpart = linked.path;
  }
  const binding = registry.bindings.find((candidate) => candidate.target === resource.path);
  if (binding) {
    const source = resources.find((candidate) => candidate.path === binding.source);
    resource.counterpart = binding.source;
    if (source?.sourceId) resource.sourceId = source.sourceId;
    if (binding.mode === "fork") resource.relationship = "fork";
    else if (binding.mode === "copy" && source)
      resource.relationship = copyRelationship(resource, source, binding, editingDigests);
    return;
  }
  if (resource.relationship !== "independent") return;
  const matches = originals.filter(
    (original) => original.name === resource.name && original.kind === resource.kind,
  );
  const match = matches[0];
  if (matches.length === 1 && match) {
    resource.counterpart = match.path;
    resource.relationship = match.digest === resource.digest ? "equalContent" : "unknownLineage";
  }
}
export function resourceInventory(
  plans: CapturePlan[],
  files: CapturedFile[],
  registry: WorkspaceRegistry,
  originalHashes = new Map<string, string>(),
): WorkspaceResource[] {
  const resources: WorkspaceResource[] = [];
  const editingDigests = new Map<string, string>();
  for (const plan of plans) {
    const entries = files.filter((file) => file.rootId === plan.root.id);
    for (const [path, group] of groupEntries(plan, entries))
      resources.push(describeResource(plan, path, group, originalHashes, editingDigests));
  }
  const originals = resources.filter((r) => r.relationship === "source");
  for (const resource of resources.filter((r) => r.relationship !== "source"))
    relateResource(resource, resources, originals, registry, editingDigests);
  // Workflow's conventional instructions are a comparison candidate, not proof of copy history.
  const codex = plans.find((plan) => plan.root.id === "codex:default");
  const legacy =
    codex &&
    resources.find((resource) => resource.path === join(codex.root.path, "instructions.md"));
  const instructions = originals.filter((resource) =>
    registry.sources.some((source) => resource.path === join(source.path, "agents/AGENTS.md")),
  );
  const instruction = instructions[0];
  if (legacy && !legacy.counterpart && instructions.length === 1 && instruction)
    legacy.counterpart = instruction.path;
  return resources.sort((a, b) => a.id.localeCompare(b.id));
}
