import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { basename, isAbsolute, join, resolve } from "node:path";
import { isDeepStrictEqual } from "node:util";
import type { WorkspaceRegistry } from "@otter/core";

const DEVICE_ID = /^[a-f\d]{8}(?:-[a-f\d]{4}){3}-[a-f\d]{12}$/i;

interface MacWorkspace {
  sources: string[];
  projects: string[];
  bindings?: WorkspaceRegistry["bindings"];
}
type StoredRegistry = WorkspaceRegistry & { macosBaseline?: MacWorkspace };
const absolutePath = (path: unknown): path is string =>
  typeof path === "string" && isAbsolute(path) && !path.includes("\0");
function validBindings(bindings: WorkspaceRegistry["bindings"]): boolean {
  return (
    Array.isArray(bindings) &&
    bindings.length <= 20000 &&
    bindings.every(
      (b) =>
        b &&
        typeof b.id === "string" &&
        b.id.length > 0 &&
        absolutePath(b.source) &&
        absolutePath(b.target) &&
        ["link", "copy", "fork"].includes(b.mode),
    ) &&
    new Set(bindings.map((b) => b.target)).size === bindings.length
  );
}
function parseMacWorkspace(raw: string): MacWorkspace {
  const value = JSON.parse(raw) as MacWorkspace;
  if (
    !value ||
    !Array.isArray(value.sources) ||
    !Array.isArray(value.projects) ||
    !value.sources.every(absolutePath) ||
    !value.projects.every(absolutePath) ||
    !validBindings(value.bindings ?? [])
  )
    throw new Error("Invalid Mac workspace configuration; use absolute paths and valid bindings");
  return { sources: value.sources, projects: value.projects, bindings: value.bindings ?? [] };
}

export async function writePrivate(path: string, value: unknown): Promise<void> {
  const temporary = `${path}.${randomUUID()}.tmp`;
  try {
    await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600, flag: "wx" });
    await rename(temporary, path);
  } finally {
    await rm(temporary, { force: true });
  }
}

export async function readRegistry(directory: string): Promise<WorkspaceRegistry> {
  try {
    const value = JSON.parse(
      await readFile(join(directory, "workspace.json"), "utf8"),
    ) as WorkspaceRegistry;
    if (
      value?.version !== 1 ||
      !Array.isArray(value.sources) ||
      !Array.isArray(value.projects) ||
      !validBindings(value.bindings) ||
      value.sources.length > 2000 ||
      value.projects.length > 2000 ||
      value.sources.some(
        (s) =>
          !s ||
          typeof s.id !== "string" ||
          !s.id ||
          typeof s.label !== "string" ||
          !absolutePath(s.path),
      ) ||
      new Set(value.sources.map((s) => s.id)).size !== value.sources.length ||
      value.projects.some((p) => !absolutePath(p))
    ) {
      throw new Error("Invalid workspace registry; repair workspace.json before scanning");
    }
    return value;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT")
      return { version: 1, sources: [], projects: [], bindings: [] };
    throw error;
  }
}

/** Read-modify-write under an exclusive lock; concurrent editors never overwrite each other. */
export async function editRegistry(
  directory: string,
  edit: (registry: WorkspaceRegistry) => void,
): Promise<WorkspaceRegistry> {
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const lock = join(directory, "workspace.lock");
  await writeFile(lock, String(process.pid), { flag: "wx", mode: 0o600 });
  try {
    const registry = await readRegistry(directory);
    edit(registry);
    await writePrivate(join(directory, "workspace.json"), registry);
    return registry;
  } finally {
    await rm(lock, { force: true });
  }
}

export function addSource(registry: WorkspaceRegistry, path: string): void {
  if (!absolutePath(path)) throw new Error("Source path must be absolute");
  const normalized = resolve(path);
  if (!registry.sources.some((s) => s.path === normalized)) {
    registry.sources.push({ id: randomUUID(), path: normalized, label: basename(normalized) });
  }
}

function importBindings(
  registry: WorkspaceRegistry,
  bindings: WorkspaceRegistry["bindings"],
): void {
  for (const binding of bindings) {
    const present = registry.bindings.find((b) => b.target === binding.target);
    if (present && (present.source !== binding.source || present.mode !== binding.mode))
      throw new Error(`Binding conflict: ${binding.target}`);
    if (!present) registry.bindings.push(binding);
  }
}
function syncBindings(
  registry: WorkspaceRegistry,
  previous: MacWorkspace,
  current: MacWorkspace,
): void {
  for (const target of new Set(
    [...(previous.bindings ?? []), ...(current.bindings ?? [])].map((b) => b.target),
  )) {
    const old = previous.bindings?.find((b) => b.target === target),
      next = current.bindings?.find((b) => b.target === target),
      existing = registry.bindings.find((b) => b.target === target);
    if (isDeepStrictEqual(old, next)) continue;
    if (existing && !isDeepStrictEqual(existing, old) && !isDeepStrictEqual(existing, next))
      throw new Error(`Binding conflict: ${target}`);
    registry.bindings = registry.bindings.filter((b) => b.target !== target);
    if (next) registry.bindings.push(next);
  }
}

/** Import old Mac preferences without replacing newer CLI registrations or binding baselines. */
export async function importWorkspace(directory: string, path: string): Promise<WorkspaceRegistry> {
  const raw = await readFile(path, "utf8");
  const old = parseMacWorkspace(raw);
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const backup = join(directory, "workspace.macos-import.json");
  try {
    await writeFile(backup, raw, { flag: "wx", mode: 0o600 });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
  }
  return editRegistry(directory, (registry) => {
    for (const source of old.sources) addSource(registry, source);
    for (const project of old.projects) {
      if (!registry.projects.includes(project)) registry.projects.push(project);
    }
    importBindings(registry, old.bindings ?? []);
  });
}

/** Apply only changes made in Mac preferences; retain independent CLI additions and diagnose concurrent binding edits. */
export async function syncWorkspace(directory: string, path: string): Promise<WorkspaceRegistry> {
  const current = parseMacWorkspace(await readFile(path, "utf8"));
  const lastPath = join(directory, "workspace.macos-last.json");
  let legacyBaseline: MacWorkspace = { sources: [], projects: [], bindings: [] };
  try {
    legacyBaseline = parseMacWorkspace(await readFile(lastPath, "utf8"));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
  const updated = await editRegistry(directory, (registry) => {
    const stored = registry as StoredRegistry;
    const previous = stored.macosBaseline ?? legacyBaseline;
    registry.sources = registry.sources.filter(
      (s) => !previous.sources.includes(s.path) || current.sources.includes(s.path),
    );
    for (const source of current.sources.filter((s) => !previous.sources.includes(s)))
      addSource(registry, source);
    registry.projects = [
      ...new Set([
        ...registry.projects.filter(
          (p) => !previous.projects.includes(p) || current.projects.includes(p),
        ),
        ...current.projects.filter((p) => !previous.projects.includes(p)),
      ]),
    ];
    syncBindings(registry, previous, current);
    // The delta baseline and registry commit together, so a crash cannot replay an old edit.
    stored.macosBaseline = current;
  });
  // Compatibility marker for the first 3.0 development builds; this file is no longer authoritative.
  await writePrivate(lastPath, current);
  return updated;
}

export async function deviceIdentity(directory: string): Promise<string> {
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const path = join(directory, "device.json");
  try {
    await writeFile(path, JSON.stringify({ id: randomUUID() }), { flag: "wx", mode: 0o600 });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
  }
  const { id } = JSON.parse(await readFile(path, "utf8")) as { id: string };
  if (typeof id !== "string" || !DEVICE_ID.test(id)) throw new Error("Invalid device identity");
  return id;
}
