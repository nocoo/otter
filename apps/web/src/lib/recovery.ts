import type { CollectedFile } from "@otter/core";
import { strToU8, type Zippable, zipSync } from "fflate";
import type { SnapshotData } from "@/components/snapshot/types";

export interface RecoveryMeta {
  id: string;
  hostname: string;
  platform: string;
  arch: string;
  snapshotAt: number;
  uploadedAt: number;
  fileCount: number;
  listCount: number;
  sizeBytes: number;
  deviceId?: string | null;
  deviceKey?: string;
  schemaVersion?: number;
  complete?: boolean | null;
  latestCompleteId?: string | null;
  sha256?: string | null;
  summary?: {
    sourceCount: number;
    agentCount: number;
    resourceCount: number;
    issues: number;
  };
}
export const coverageLabel = (complete?: boolean | null): string =>
  complete == null
    ? "Legacy · coverage unknown"
    : complete
      ? "Complete within policy"
      : "Partial capture";
export const fileKey = (file: CollectedFile, collector: string, home: string): string =>
  file.rootId
    ? `${file.rootId}/${file.relativePath}`
    : `${collector}/${file.path.replace(home || "\0", "~")}`;
export const fileBytes = (file: CollectedFile): Uint8Array<ArrayBuffer> =>
  file.encoding === "base64"
    ? Uint8Array.from(atob(file.content), (c) => c.charCodeAt(0))
    : strToU8(file.content);
export function materializedFiles(snapshot: SnapshotData): CollectedFile[] {
  const files = snapshot.collectors.flatMap((c) => c.files as CollectedFile[]);
  const inline = new Map(files.filter((f) => f.sha256 && !f.contentRef).map((f) => [f.sha256, f]));
  return files.map((file) => {
    if (!file.contentRef) return file;
    const source = inline.get(file.contentRef);
    if (
      !source ||
      source.sha256 !== file.sha256 ||
      source.encoding !== file.encoding ||
      source.sizeBytes !== file.sizeBytes
    )
      throw new Error("Invalid snapshot content reference");
    return { ...file, content: source.content };
  });
}
const safePath = (path: string): boolean =>
  !!path &&
  !path.includes("\\") &&
  !path.includes("\0") &&
  !path.split("/").some((p) => p === ".." || p === "." || p === "");

const LEADING_SLASHES = /^\/+/;
type Selection = { rootId: string; relativePath: string };
const isDirectory = (file: CollectedFile) =>
  file.kind === "directory" || file.targetKind === "directory";
function selected(file: CollectedFile, selection?: Selection): boolean {
  if (!selection) return true;
  return (
    file.rootId === selection.rootId &&
    (selection.relativePath === "." ||
      file.relativePath === selection.relativePath ||
      !!file.relativePath?.startsWith(`${selection.relativePath}/`))
  );
}
function archivePath(file: CollectedFile, collector: string, home: string): string {
  const root = file.rootId
    ? `roots/${encodeURIComponent(file.rootId).replaceAll(".", "%2E")}`
    : `legacy/${encodeURIComponent(collector).replaceAll(".", "%2E")}`;
  const relative =
    file.relativePath ?? file.path.replace(home || "\0", "home").replace(LEADING_SLASHES, "");
  if (relative === "." && isDirectory(file)) return root;
  return `${root}/${relative === "." ? file.path.split("/").pop() : relative}`;
}
async function zipEntry(file: CollectedFile, path: string): Promise<Zippable[string] | undefined> {
  if (isDirectory(file))
    return [
      new Uint8Array(),
      { os: 3, attrs: (((0o040000 | (file.mode ?? 0o700)) << 16) | 0x10) >>> 0 },
    ];
  if ((file.kind === "symlink" && !file.sha256) || typeof file.content !== "string")
    return undefined;
  const bytes = fileBytes(file);
  if (file.sha256) {
    const hash = [...new Uint8Array(await crypto.subtle.digest("SHA-256", bytes))]
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("");
    if (hash !== file.sha256) throw new Error(`Content verification failed: ${path}`);
  }
  return [bytes, { os: 3, attrs: ((0o100000 | (file.mode ?? 0o600)) << 16) >>> 0 }];
}

function linkMetadata(file: CollectedFile, path: string, available: boolean) {
  if (!file.linkTarget && !file.links?.length) return undefined;
  return {
    path,
    target: file.linkTarget,
    chain: file.links,
    materialized: !available ? "unavailable" : isDirectory(file) ? "directory" : "file",
  };
}

function recoveryInstructions(snapshot: SnapshotData): string {
  return `# Otter recovery\n\nCaptured ${snapshot.createdAt}.\n\nFiles in roots/ or legacy/ are ordinary files. Original paths, modes and link topology are in manifest.json and links.json. Review before copying to an agent configuration directory; reapply executable modes recorded in the manifest. Credentials may be redacted: sign in again. Software binaries are not included; environment.json is a reinstall reference.\n\n${snapshot.version === 1 ? "Legacy snapshots can contain skill names without package contents. A name-only entry cannot recover the skill.\n" : "Check every coverage issue before recovery. A successful upload does not imply complete capture.\n"}`;
}

/** Materialized ZIP, with original link/mode metadata and enough context to recover without the source machine. */
export async function recoveryArchive(
  snapshot: SnapshotData,
  selection?: Selection,
): Promise<Uint8Array<ArrayBuffer>> {
  const entries: Zippable = {},
    links = [],
    manifest = [];
  const paths = new Set<string>();
  const materialized = new Map(
    materializedFiles(snapshot).map((file) => [`${file.rootId ?? ""}\0${file.path}`, file]),
  );
  const files = snapshot.collectors.flatMap((collector) =>
    collector.files.map((raw) => ({
      file: materialized.get(
        `${(raw as CollectedFile).rootId ?? ""}\0${raw.path}`,
      ) as CollectedFile,
      collector: collector.id,
    })),
  );
  for (const { file, collector } of files) {
    if (!selected(file, selection)) continue;
    const path = archivePath(file, collector, snapshot.machine.homeDir ?? "");
    if (!safePath(path) || paths.has(path))
      throw new Error("Archive contains unsafe or duplicate paths");
    paths.add(path);
    manifest.push({ ...file, content: undefined });
    // biome-ignore lint/performance/noAwaitInLoops: verify one file at a time to bound digest memory
    const entry = await zipEntry(file, path);
    const link = linkMetadata(file, path, !!entry);
    if (link) links.push(link);
    if (entry) entries[isDirectory(file) ? `${path}/` : path] = entry;
  }
  entries["manifest.json"] = strToU8(
    JSON.stringify(
      {
        snapshotId: snapshot.id,
        capturedAt: snapshot.createdAt,
        machine: snapshot.machine,
        roots: snapshot.workspace?.roots,
        coverage: snapshot.workspace?.coverage,
        files: manifest,
      },
      null,
      2,
    ),
  );
  entries["links.json"] = strToU8(JSON.stringify(links, null, 2));
  if (!selection) {
    entries["snapshot.json"] = strToU8(JSON.stringify(snapshot, null, 2));
    entries["environment.json"] = strToU8(
      JSON.stringify(
        snapshot.collectors.map((c) => ({ collector: c.label, items: c.lists })),
        null,
        2,
      ),
    );
  }
  entries["RESTORE.md"] = strToU8(recoveryInstructions(snapshot));
  return zipSync(entries, { level: 6 }) as Uint8Array<ArrayBuffer>;
}

export interface RecoveryDiff {
  path: string;
  change: "added" | "removed" | "changed";
  before?: CollectedFile;
  after?: CollectedFile;
}
function fileChanged(old: CollectedFile, file: CollectedFile): boolean {
  return (
    (old.sha256 && file.sha256 ? old.sha256 !== file.sha256 : old.content !== file.content) ||
    ["mode", "linkTarget", "kind", "targetKind", "entryMode", "encoding"].some(
      (key) => old[key as keyof CollectedFile] !== file[key as keyof CollectedFile],
    ) ||
    JSON.stringify(old.links) !== JSON.stringify(file.links)
  );
}
export function compareRecovery(
  before: SnapshotData,
  after: SnapshotData,
): {
  files: RecoveryDiff[];
  environment: { collector: string; before: string; after: string }[];
  incomplete: boolean;
  scopeChanged: boolean;
} {
  const map = (snapshot: SnapshotData) => {
    const materialized = new Map(
      materializedFiles(snapshot).map((file) => [`${file.rootId ?? ""}\0${file.path}`, file]),
    );
    return new Map(
      snapshot.collectors.flatMap((c) =>
        c.files.map((raw) => {
          const file = materialized.get(
            `${(raw as CollectedFile).rootId ?? ""}\0${raw.path}`,
          ) as CollectedFile;
          return [fileKey(file, c.id, snapshot.machine.homeDir ?? ""), file] as const;
        }),
      ),
    );
  };
  const oldFiles = map(before),
    newFiles = map(after);
  const scopeChanged =
    !!before.workspace &&
    !!after.workspace &&
    before.workspace.scopeFingerprint !== after.workspace.scopeFingerprint;
  const incomplete =
    scopeChanged ||
    after.workspace?.coverage.complete === false ||
    after.collectors.some((c) => c.errors.length > 0);
  const files: RecoveryDiff[] = [];
  for (const [path, file] of newFiles) {
    const old = oldFiles.get(path);
    if (!old) files.push({ path, change: "added", after: file });
    else if (fileChanged(old, file))
      files.push({ path, change: "changed", before: old, after: file });
  }
  if (!incomplete)
    for (const [path, file] of oldFiles)
      if (!newFiles.has(path)) files.push({ path, change: "removed", before: file });
  const environment = [
    ...new Set([...before.collectors, ...after.collectors].map((c) => c.id)),
  ].flatMap((id) => {
    const old = before.collectors.find((c) => c.id === id),
      next = after.collectors.find((c) => c.id === id);
    const first = JSON.stringify(old?.lists ?? [], null, 2),
      second = JSON.stringify(next?.lists ?? [], null, 2);
    return first === second || (incomplete && !next)
      ? []
      : [{ collector: next?.label ?? old?.label ?? id, before: first, after: second }];
  });
  return { files, environment, incomplete, scopeChanged };
}
