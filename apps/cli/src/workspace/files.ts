// biome-ignore-all lint/performance/noAwaitInLoops: sequential traversal enforces one shared byte and entry budget
import { createHash } from "node:crypto";
import { constants, type Stats } from "node:fs";
import { lstat, open, readdir, readlink } from "node:fs/promises";
import { basename, dirname, join, relative, resolve, sep } from "node:path";
import type { CaptureRoot, CollectedFile, CoverageIssue, WorkspaceCapture } from "@otter/core";
import { redactCapturedText } from "../utils/redact.js";

export const CAPTURE_POLICY = {
  version: 1,
  maxFileBytes: 4 * 1024 * 1024,
  maxTotalBytes: 32 * 1024 * 1024,
  maxEntries: 20_000,
  maxDepth: 32,
};
const EXCLUDED = new Set([
  ".git",
  "node_modules",
  ".venv",
  "venv",
  "__pycache__",
  ".cache",
  "cache",
  ".DS_Store",
  ".next",
  ".turbo",
]);
const PRIVATE =
  /^(?:\.env(?:\..+)?|auth\.json|credentials(?:\.json)?|id_(?:rsa|ed25519)|.*\.(?:pem|key|p12|db|sqlite|sqlite3))$/i;
export const digest = (value: string | Uint8Array): string =>
  createHash("sha256").update(value).digest("hex");
export const within = (path: string, root: string): boolean =>
  path === root || path.startsWith(`${root}${sep}`);

export interface PathResolution {
  finalPath: string;
  links: NonNullable<CollectedFile["links"]>;
  error?: string;
}
/** Resolve every component, preserving parent links as well as file and directory links. */
export async function resolvePath(path: string): Promise<PathResolution> {
  const links: PathResolution["links"] = [];
  let pending = path.split(sep).filter(Boolean);
  let current: string = sep;
  const visited = new Set<string>();
  try {
    while (pending.length) {
      const component = pending.shift() as string;
      if (component === ".") continue;
      if (component === "..") {
        current = dirname(current);
        continue;
      }
      current = join(current, component);
      const info = await lstat(current);
      if (!info.isSymbolicLink()) continue;
      if (links.length >= 40 || visited.has(`${current}\0${pending.join(sep)}`))
        throw new Error("Symbolic link cycle or depth limit");
      visited.add(`${current}\0${pending.join(sep)}`);
      const target = await readlink(current);
      const resolvedPath = resolve(dirname(current), target);
      links.push({ path: current, target, resolvedPath });
      pending = [...target.split(sep).filter(Boolean), ...pending];
      current = target.startsWith(sep) ? sep : dirname(current);
    }
    return { finalPath: current, links };
  } catch (error) {
    return { finalPath: current, links, error: (error as Error).message };
  }
}

export interface CapturePlan {
  root: CaptureRoot;
  include?: string[];
  skillRoot?: boolean;
  consumers?: {
    agentId: string;
    include?: string[];
    disabledPaths?: string[];
    legacyPaths?: string[];
  }[];
}
export type CapturedFile = CollectedFile &
  Required<
    Pick<
      CollectedFile,
      "rootId" | "relativePath" | "kind" | "mode" | "links" | "resolvedPath" | "encoding"
    >
  >;

/** Bounded regular-file reads are shared by discovery parsers and content capture. */
export async function readStableFile(
  path: string,
  limit: number,
  expected?: Stats,
): Promise<Buffer> {
  const info = expected ?? (await lstat(path));
  if (!info.isFile()) throw new Error("Configuration is not a regular file");
  if (info.size > limit) throw new Error(`File exceeds read limit (${info.size} bytes)`);
  const handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  const changed = () =>
    Object.assign(new Error("File changed during capture; scan again"), { code: "ESTALE" });
  const same = (value: Stats) =>
    value.isFile() &&
    value.ino === info.ino &&
    value.dev === info.dev &&
    value.size === info.size &&
    value.mtimeMs === info.mtimeMs;
  try {
    if (!same(await handle.stat())) throw changed();
    const bytes = Buffer.alloc(info.size + 1);
    let offset = 0;
    while (offset < bytes.length) {
      const { bytesRead } = await handle.read(bytes, offset, bytes.length - offset, offset);
      if (bytesRead === 0) break;
      offset += bytesRead;
    }
    if (offset !== info.size || !same(await handle.stat()) || !same(await lstat(path)))
      throw changed();
    return bytes.subarray(0, offset);
  } finally {
    await handle.close();
  }
}
export class FileCapture {
  files: CapturedFile[] = [];
  issues: CoverageIssue[] = [];
  bytes = 0;
  readonly originalHashes = new Map<string, string>();
  private readonly contents = new Set<string>();
  constructor(readonly policy: WorkspaceCapture["coverage"]["policy"] = CAPTURE_POLICY) {}

  issue(root: CaptureRoot, path: string, status: CoverageIssue["status"], reason: string): void {
    this.issues.push({ rootId: root.id, path, status, reason });
    if (["error", "limit", "unstable"].includes(status)) root.status = "partial";
  }

  async capture(plan: CapturePlan): Promise<void> {
    if (plan.include) plan.root.include = plan.include;
    plan.root.entryPath = join(
      (await resolvePath(dirname(plan.root.path))).finalPath,
      basename(plan.root.path),
    );
    if (!plan.include) {
      await this.walk(plan.root.path, plan.root, 0, new Set());
      return;
    }
    const resolution = await resolvePath(plan.root.path);
    if (resolution.error) {
      this.issue(plan.root, plan.root.path, "error", resolution.error);
      plan.root.status = "missing";
      return;
    }
    for (const selected of plan.include) {
      const path = join(plan.root.path, selected);
      try {
        await lstat(path);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT")
          this.issue(plan.root, path, "error", (error as Error).message);
        continue;
      }
      await this.walk(path, plan.root, 0, new Set());
    }
  }

  // biome-ignore lint/complexity/noExcessiveCognitiveComplexity: all filesystem outcomes must produce an explicit coverage result
  private async walk(
    path: string,
    root: CaptureRoot,
    depth: number,
    ancestry: Set<string>,
  ): Promise<void> {
    if (EXCLUDED.has(basename(path)) || PRIVATE.test(basename(path))) {
      this.issue(
        root,
        path,
        "excluded",
        "Policy excludes credentials, runtime databases and generated caches",
      );
      return;
    }
    if (depth > this.policy.maxDepth || this.files.length >= this.policy.maxEntries) {
      this.issue(root, path, "limit", "Capture depth, entry or total byte limit reached");
      return;
    }
    const resolution = await resolvePath(path);
    const entry: CapturedFile = {
      rootId: root.id,
      relativePath: relative(root.path, path) || ".",
      path,
      resolvedPath: resolution.finalPath,
      content: "",
      sizeBytes: 0,
      encoding: "utf8",
      links: resolution.links,
      kind: "file",
      mode: 0,
    };
    try {
      const own = await lstat(path);
      entry.kind = own.isSymbolicLink() ? "symlink" : own.isDirectory() ? "directory" : "file";
      entry.mode = own.mode & 0o777;
      if (own.isSymbolicLink()) entry.entryMode = entry.mode;
      if (own.isSymbolicLink()) entry.linkTarget = await readlink(path);
      if (resolution.error) {
        if (entry.kind === "symlink") this.files.push(entry);
        throw new Error(resolution.error);
      }
      const info = await lstat(resolution.finalPath);
      entry.mode = info.mode & 0o777;
      if (info.isFile() || info.isDirectory())
        entry.targetKind = info.isDirectory() ? "directory" : "file";
      if (entry.kind !== "symlink" && own.isDirectory() !== info.isDirectory()) {
        this.issue(root, path, "unstable", "Entry type changed during capture; scan again");
        return;
      }
      if (info.isDirectory()) {
        this.files.push(entry);
        if (ancestry.has(resolution.finalPath)) {
          this.issue(root, path, "error", "Directory link cycle");
          return;
        }
        const next = new Set(ancestry).add(resolution.finalPath);
        const before = info.mtimeMs;
        for (const child of (await readdir(resolution.finalPath)).sort())
          await this.walk(join(path, child), root, depth + 1, next);
        if ((await lstat(resolution.finalPath)).mtimeMs !== before)
          this.issue(root, path, "unstable", "Directory changed during capture; scan again");
      } else if (info.isFile()) {
        if (info.size > this.policy.maxFileBytes) {
          this.issue(root, path, "limit", `File exceeds capture byte limit (${info.size} bytes)`);
          return;
        }
        const bytes = await readStableFile(resolution.finalPath, this.policy.maxFileBytes, info);
        const after = await resolvePath(path);
        if (
          after.error ||
          after.finalPath !== resolution.finalPath ||
          JSON.stringify(after.links) !== JSON.stringify(resolution.links)
        ) {
          this.issue(root, path, "unstable", "Link changed during capture; scan again");
          return;
        }
        this.originalHashes.set(path, digest(bytes));
        let text: string | undefined;
        try {
          if (!bytes.includes(0)) text = new TextDecoder("utf8", { fatal: true }).decode(bytes);
        } catch {
          /* Binary assets are preserved in base64. */
        }
        if (text === undefined) {
          entry.encoding = "base64";
          entry.content = bytes.toString("base64");
        } else {
          entry.content = redactCapturedText(text, path);
          if (entry.content !== text) {
            entry.redacted = true;
            this.issue(
              root,
              path,
              "redacted",
              "Credential values removed; restore requires reauthentication",
            );
          }
        }
        const saved = Buffer.from(entry.content, entry.encoding === "base64" ? "base64" : "utf8");
        entry.sha256 = digest(saved);
        entry.sizeBytes = saved.length;
        if (this.contents.has(entry.sha256)) {
          entry.contentRef = entry.sha256;
          entry.content = "";
        } else {
          if (this.bytes + saved.length > this.policy.maxTotalBytes) {
            this.issue(root, path, "limit", "Unique content exceeds total capture byte limit");
            return;
          }
          this.contents.add(entry.sha256);
          this.bytes += saved.length;
        }
        this.files.push(entry);
      } else {
        this.issue(root, path, "excluded", "Special filesystem object (socket, FIFO or device)");
      }
    } catch (error) {
      this.issue(
        root,
        path,
        (error as NodeJS.ErrnoException).code === "ESTALE" ? "unstable" : "error",
        (error as Error).message,
      );
    }
  }
}
