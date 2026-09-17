import { chmod, mkdir, realpath, writeFile } from "node:fs/promises";
import { basename, isAbsolute, join, relative, resolve } from "node:path";
import type { CollectedFile, Snapshot } from "@otter/core";
import { digest } from "../workspace/files.js";
import { snapshotFiles } from "./content.js";

const safePath = (value: string): boolean =>
  !!value &&
  !isAbsolute(value) &&
  !value.includes("\\") &&
  !value.includes("\0") &&
  !value.split("/").some((p) => p === ".." || p === "" || p === ".");
const LEADING_SLASHES = /^\/+/;

function exportPath(
  file: CollectedFile,
  collector: string,
  home: string,
  directory: boolean,
): string {
  const root = file.rootId
    ? `roots/${encodeURIComponent(file.rootId).replaceAll(".", "%2E")}`
    : `legacy/${encodeURIComponent(collector).replaceAll(".", "%2E")}`;
  const original =
    file.relativePath ?? file.path.replace(home, "home").replace(LEADING_SLASHES, "");
  const portable = original === "." ? basename(file.path) : original;
  const path = directory && original === "." ? root : `${root}/${portable}`;
  if (!safePath(path)) throw new Error(`Unsafe snapshot path: ${portable}`);
  return path;
}
function exportEntry(file: CollectedFile, collector: string, home: string) {
  const directory = file.kind === "directory" || file.targetKind === "directory";
  const unavailable = file.kind === "symlink" && !file.sha256 && !directory;
  const path = exportPath(file, collector, home, directory);
  const materialized = unavailable ? "unavailable" : directory ? "directory" : "file";
  const link =
    file.links?.length || file.linkTarget
      ? {
          path,
          target: file.linkTarget,
          resolvedPath: file.resolvedPath,
          links: file.links,
          materialized,
        }
      : undefined;
  const mode = (file.mode ?? (directory ? 0o700 : 0o600)) & 0o777;
  if (directory || unavailable || typeof file.content !== "string")
    return { path, mode, directory, link };
  const content = Buffer.from(file.content, file.encoding === "base64" ? "base64" : "utf8");
  if (file.sha256 && digest(content) !== file.sha256)
    throw new Error(`Content digest mismatch: ${path}`);
  return { path, mode, directory, link, content };
}

function restoreInstructions(snapshot: Snapshot): string {
  return `# Otter recovery export\n\nSnapshot: ${snapshot.id}\nCaptured: ${snapshot.createdAt}\n\nFiles are under roots/ (v2) or legacy/ (v1). Root mappings and coverage are in snapshot.json. Links are materialized as ordinary files/directories so no original source repository is required; links.json records original targets. Review before copying to live configuration folders. Reauthenticate redacted credentials. Reinstall software using environment.json; binaries are not included.\n\n${snapshot.version === 1 ? "Legacy v1 snapshots may contain skill names only. Missing package content cannot be recovered from a list.\n" : `Coverage: ${snapshot.workspace?.coverage.complete ? "complete within the recorded policy" : "partial; inspect coverage issues before recovery"}.\n`}`;
}

async function writeExportFile(
  physical: string,
  output: { path: string; content: Uint8Array; mode: number },
): Promise<void> {
  const path = join(physical, output.path);
  const parent = resolve(path, "..");
  await mkdir(parent, { recursive: true, mode: 0o700 });
  if ((await realpath(parent)) !== parent || relative(physical, path).startsWith(".."))
    throw new Error("Export directory was redirected");
  await writeFile(path, output.content, { flag: "wx", mode: output.mode });
}

/** Export to a newly created directory. Link targets are materialized; links.json preserves the topology. */
export async function exportSnapshot(
  snapshot: Snapshot,
  destination: string,
): Promise<{ directory: string; files: number }> {
  if (!isAbsolute(destination)) throw new Error("Export destination must be absolute");
  const directory = resolve(destination);
  const outputs: { path: string; content: Uint8Array; mode: number }[] = [];
  const directories = new Map<string, number>();
  const paths = new Set<string>();
  const links = [];
  const materialized = new Map(
    snapshotFiles(snapshot).map((file) => [`${file.rootId ?? ""}\0${file.path}`, file]),
  );
  const entries = snapshot.collectors.flatMap((collector) =>
    collector.files.map((raw) =>
      exportEntry(
        materialized.get(`${raw.rootId ?? ""}\0${raw.path}`) as CollectedFile,
        collector.id,
        snapshot.machine.homeDir,
      ),
    ),
  );
  for (const entry of entries) {
    if (paths.has(entry.path)) throw new Error(`Duplicate snapshot path: ${entry.path}`);
    paths.add(entry.path);
    if (entry.link) links.push(entry.link);
    if (entry.directory) directories.set(entry.path, entry.mode);
    if (entry.content) outputs.push({ path: entry.path, content: entry.content, mode: entry.mode });
  }
  // Refuse existing destinations; never overlay a live agent configuration or follow an existing child link.
  await mkdir(directory, { mode: 0o700 });
  const physical = await realpath(directory);
  for (const path of directories.keys()) {
    // biome-ignore lint/performance/noAwaitInLoops: create the recorded tree before writing any files
    await mkdir(join(physical, path), { recursive: true, mode: 0o700 });
  }
  for (const output of outputs) {
    // biome-ignore lint/performance/noAwaitInLoops: exclusive writes in the private recovery tree
    await writeExportFile(physical, output);
  }
  const environment = snapshot.collectors
    .filter((c) => c.lists.length)
    .map((c) => ({ collector: c.label, items: c.lists }));
  await writeFile(join(physical, "snapshot.json"), JSON.stringify(snapshot, null, 2), {
    mode: 0o600,
    flag: "wx",
  });
  await writeFile(join(physical, "links.json"), JSON.stringify(links, null, 2), {
    mode: 0o600,
    flag: "wx",
  });
  await writeFile(join(physical, "environment.json"), JSON.stringify(environment, null, 2), {
    mode: 0o600,
    flag: "wx",
  });
  await writeFile(join(physical, "RESTORE.md"), restoreInstructions(snapshot), {
    mode: 0o600,
    flag: "wx",
  });
  for (const [path, mode] of [...directories.entries()].sort((a, b) => b[0].length - a[0].length)) {
    // biome-ignore lint/performance/noAwaitInLoops: apply restrictive parent modes last
    await chmod(join(physical, path), mode);
  }
  return { directory: physical, files: outputs.length };
}
