// Snapshot payload validation + metadata extraction, shared between
// /api/snapshots (Bearer) and legacy /ingest/:token (webhook token) routes.

import type { WorkspaceCapture } from "@otter/core";
import { z } from "zod";

export interface SnapshotPayload {
  version: 1 | 2;
  id: string;
  createdAt: string;
  machine: {
    hostname: string;
    computerName?: string;
    platform: string;
    arch: string;
    username: string;
  };
  collectors: Array<{
    files: Array<unknown>;
    lists: Array<unknown>;
  }>;
  workspace?: WorkspaceCapture;
}

export interface SnapshotIndexMetadata {
  hostname: string;
  platform: string;
  arch: string;
  username: string;
  collectorCount: number;
  fileCount: number;
  listCount: number;
}
const SNAPSHOT_ID = /^[A-Za-z\d_-]{1,128}$/;

export function isValidSnapshotPayload(data: unknown): data is SnapshotPayload {
  if (typeof data !== "object" || data === null) return false;
  const obj = data as Record<string, unknown>;
  return (
    [1, 2].includes(obj["version"] as number) &&
    typeof obj["id"] === "string" &&
    SNAPSHOT_ID.test(obj["id"]) &&
    typeof obj["createdAt"] === "string" &&
    Number.isFinite(Date.parse(obj["createdAt"])) &&
    typeof obj["machine"] === "object" &&
    obj["machine"] !== null &&
    ["hostname", "platform", "arch", "username"].every(
      (key) =>
        typeof (obj["machine"] as Record<string, unknown>)[key] === "string" &&
        String((obj["machine"] as Record<string, unknown>)[key]).length <= 8192,
    ) &&
    Array.isArray(obj["collectors"]) &&
    obj["collectors"].length <= 100 &&
    obj["collectors"].every((c) => c && Array.isArray(c.files) && Array.isArray(c.lists))
  );
}

export async function sha256(content: string | Uint8Array): Promise<string> {
  const bytes = typeof content === "string" ? new TextEncoder().encode(content) : content;
  return [
    ...new Uint8Array(await crypto.subtle.digest("SHA-256", bytes as Uint8Array<ArrayBuffer>)),
  ]
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

const text = z
  .string()
  .max(8192)
  .refine((value) => !value.includes("\0"));
const hex = z.string().regex(/^[a-f\d]{64}$/);
const identifier = text.min(1).max(512);
const absolute = text.refine((path) => path.startsWith("/"));
const portable = text.refine(
  (path) =>
    path === "." ||
    (!!path &&
      !path.includes("\\") &&
      !path.split("/").some((p) => p === ".." || p === "." || p === "")),
);
const kind = z.enum(["skill", "instruction", "command", "rule", "hook", "configuration"]);
const agent = z.enum(["claude", "codex", "grok", "pi", "hermes", "opencode", "gemini"]);
const rootSchema = z.object({
  id: identifier,
  path: absolute,
  entryPath: absolute.optional(),
  include: z.array(portable).max(2000).optional(),
  cwd: absolute.optional(),
  label: text,
  role: z.enum(["source", "agent", "external", "shared", "project"]),
  agentIds: z.array(identifier).max(2000),
  status: z.enum(["complete", "partial", "missing"]),
  git: z
    .object({
      checkedAt: z.iso.datetime(),
      repository: z.boolean(),
      branch: text.optional(),
      commit: text.optional(),
      upstream: text.optional(),
      remote: text.optional(),
      repoKey: hex.optional(),
      ahead: z.number().int().nonnegative(),
      behind: z.number().int().nonnegative(),
      staged: z.number().int().nonnegative(),
      unstaged: z.number().int().nonnegative(),
      untracked: z.number().int().nonnegative(),
      conflicts: z.number().int().nonnegative(),
      detached: z.boolean(),
      unborn: z.boolean(),
      remoteCheckedAt: z.iso.datetime().optional(),
      fetchError: text.optional(),
      error: text.optional(),
    })
    .optional(),
});
const fileSchema = z.object({
  path: absolute,
  content: z.string().max(12 * 1024 * 1024),
  sizeBytes: z
    .number()
    .int()
    .min(0)
    .max(8 * 1024 * 1024),
  rootId: identifier.optional(),
  relativePath: portable.optional(),
  kind: z.enum(["file", "directory", "symlink"]).optional(),
  targetKind: z.enum(["file", "directory"]).optional(),
  encoding: z.enum(["utf8", "base64"]).optional(),
  sha256: hex.optional(),
  mode: z.number().int().min(0).max(0o777).optional(),
  entryMode: z.number().int().min(0).max(0o777).optional(),
  contentRef: hex.optional(),
  linkTarget: text.optional(),
  resolvedPath: absolute.optional(),
  redacted: z.boolean().optional(),
  links: z
    .array(z.object({ path: absolute, target: text, resolvedPath: absolute }))
    .max(40)
    .optional(),
});
const workspaceSchema = z.object({
  schemaVersion: z.literal(2),
  deviceId: identifier,
  observedAt: z.iso.datetime(),
  contentFingerprint: hex,
  configurationFingerprint: hex,
  scopeFingerprint: hex,
  registry: z.object({
    version: z.literal(1),
    sources: z.array(z.object({ id: identifier, path: absolute, label: text })).max(2000),
    projects: z.array(absolute).max(2000),
    bindings: z
      .array(
        z.object({
          id: identifier,
          source: absolute,
          target: absolute,
          mode: z.enum(["link", "copy", "fork"]),
          baseSource: text.optional(),
          baseTarget: text.optional(),
          createdAt: z.union([z.number(), text]).optional(),
        }),
      )
      .max(20000),
  }),
  roots: z.array(rootSchema).max(2000),
  agents: z
    .array(
      z.object({
        id: identifier,
        kind: agent,
        profile: text,
        configPath: absolute,
        executable: absolute.optional(),
        version: text.optional(),
        discovery: z.literal("on-disk"),
      }),
    )
    .max(2000),
  resources: z
    .array(
      z.object({
        id: text,
        rootId: identifier,
        relativePath: portable,
        path: absolute,
        resolvedPath: absolute.optional(),
        sourceId: identifier.optional(),
        counterpart: absolute.optional(),
        name: text,
        kind,
        agentIds: z.array(identifier).max(2000),
        discovery: z
          .array(
            z.object({
              agentId: identifier,
              state: z.enum(["on-disk", "disabled", "unsupported", "project-only"]),
              reason: text.optional(),
              cwd: absolute.optional(),
            }),
          )
          .max(2000)
          .optional(),
        relationship: z.enum([
          "source",
          "independent",
          "symlink",
          "hardlink",
          "configurationReference",
          "managedCopy",
          "sourceChanged",
          "localChanged",
          "bothChanged",
          "fork",
          "equalContent",
          "unknownLineage",
          "broken",
        ]),
        digest: z.union([hex, z.literal("")]),
        fileCount: z.number().int().min(0),
      }),
    )
    .max(20000),
  coverage: z.object({
    complete: z.boolean(),
    files: z.number().int().min(0),
    bytes: z.number().int().min(0),
    issues: z
      .array(
        z.object({
          rootId: text,
          path: text,
          status: z.enum([
            "excluded",
            "redacted",
            "error",
            "limit",
            "unstable",
            "invalid",
            "list-only",
          ]),
          reason: text,
        }),
      )
      .max(40000),
    policy: z.object({
      version: z.number().int().positive(),
      maxFileBytes: z.number().positive(),
      maxTotalBytes: z.number().positive(),
      maxEntries: z.number().positive(),
      maxDepth: z.number().positive(),
    }),
  }),
});

type SavedFile = z.infer<typeof fileSchema>;
type SavedWorkspace = z.infer<typeof workspaceSchema>;
const TRAILING_SLASHES = /\/+$/;
const rootFilePath = (root: { path: string }, relative: string) =>
  relative === "." ? root.path : `${root.path.replace(TRAILING_SLASHES, "")}/${relative}`;

function validManifest(workspace: SavedWorkspace): boolean {
  const roots = new Map(workspace.roots.map((root) => [root.id, root]));
  const agents = new Set(workspace.agents.map((agent) => agent.id));
  if (
    roots.size !== workspace.roots.length ||
    agents.size !== workspace.agents.length ||
    new Set(workspace.resources.map((resource) => resource.id)).size !== workspace.resources.length
  )
    return false;
  if (workspace.roots.some((root) => root.agentIds.some((id) => !agents.has(id)))) return false;
  if (
    workspace.coverage.complete &&
    (workspace.roots.some((root) => root.status !== "complete") ||
      workspace.coverage.issues.some((issue) =>
        ["error", "limit", "unstable"].includes(issue.status),
      ))
  )
    return false;
  return workspace.resources.every((resource) => {
    const root = roots.get(resource.rootId);
    return (
      !!root &&
      resource.path === rootFilePath(root, resource.relativePath) &&
      (!resource.sourceId || roots.get(resource.sourceId)?.role === "source") &&
      resource.agentIds.every((id) => agents.has(id)) &&
      !resource.discovery?.some((discovery) => !resource.agentIds.includes(discovery.agentId))
    );
  });
}

function validRootEntry(
  file: SavedFile,
  roots: Map<string, SavedWorkspace["roots"][number]>,
  paths: Set<string>,
): boolean {
  if (file.rootId === undefined) return true;
  const root = roots.get(file.rootId);
  if (
    !root ||
    file.relativePath === undefined ||
    file.kind === undefined ||
    file.encoding === undefined ||
    file.mode === undefined ||
    file.links === undefined ||
    (file.kind === "symlink" && !file.linkTarget)
  )
    return false;
  if (file.path !== rootFilePath(root, file.relativePath)) return false;
  const key = `${file.rootId}/${file.relativePath}`;
  if (paths.has(key)) return false;
  paths.add(key);
  return true;
}
function validSavedBytes(file: SavedFile, size: number): boolean {
  if (!file.rootId) return true;
  if (file.sizeBytes !== size) return false;
  if (file.kind === "directory" || file.targetKind === "directory")
    return !file.sha256 && !size && !file.contentRef;
  return !!file.sha256 || (file.kind !== "file" && size === 0);
}

async function validatedSize(
  file: SavedFile,
  inline: Map<string, SavedFile>,
): Promise<number | null> {
  const reference = file.contentRef ? inline.get(file.contentRef) : undefined;
  if (
    file.contentRef &&
    (!reference ||
      reference.sha256 !== file.sha256 ||
      reference.encoding !== file.encoding ||
      reference.sizeBytes !== file.sizeBytes ||
      file.content !== "")
  )
    return null;
  const content = reference?.content ?? file.content;
  let bytes: Uint8Array;
  try {
    bytes =
      file.encoding === "base64"
        ? Uint8Array.from(atob(content), (character) => character.charCodeAt(0))
        : new TextEncoder().encode(content);
  } catch {
    return null;
  }
  if (!validSavedBytes(file, bytes.length)) return null;
  if (file.sha256 !== undefined && (await sha256(bytes)) !== file.sha256) return null;
  return bytes.length;
}

function parseFiles(
  snapshot: SnapshotPayload,
  roots: Map<string, SavedWorkspace["roots"][number]>,
) {
  const files: SavedFile[] = [],
    paths = new Set<string>(),
    inline = new Map<string, SavedFile>();
  const rawFiles = snapshot.collectors.flatMap((collector) => collector.files);
  if (rawFiles.length > 30000) return null;
  for (const value of rawFiles) {
    const file = fileSchema.safeParse(value);
    if (!file.success || !validRootEntry(file.data, roots, paths)) return null;
    files.push(file.data);
    if (file.data.sha256 && !file.data.contentRef) inline.set(file.data.sha256, file.data);
  }
  return { files, inline };
}

/** v1 stays readable; v2 validates the recovery manifest and every saved-byte digest. */
export async function validateSnapshotContents(snapshot: SnapshotPayload): Promise<boolean> {
  if (snapshot.version === 1) return true;
  const parsed = workspaceSchema.safeParse(snapshot.workspace);
  if (!parsed.success || !validManifest(parsed.data)) return false;
  const workspace = parsed.data;
  const roots = new Map(workspace.roots.map((root) => [root.id, root]));
  const captured = parseFiles(snapshot, roots);
  if (!captured) return false;
  const { files, inline } = captured;
  let total = 0,
    rootBytes = 0;
  const rootFiles = files.filter((file) => file.rootId && file.sha256).length;
  for (const file of files) {
    // biome-ignore lint/performance/noAwaitInLoops: bound hashing memory to one file
    const size = await validatedSize(file, inline);
    if (size === null) return false;
    if (!file.contentRef) total += size;
    if (total > 48 * 1024 * 1024) return false;
    if (file.rootId && !file.contentRef) rootBytes += size;
  }
  return rootFiles === workspace.coverage.files && rootBytes === workspace.coverage.bytes;
}

export function extractSnapshotMetadata(snapshot: SnapshotPayload): SnapshotIndexMetadata {
  const machine = snapshot.machine;
  let fileCount = 0;
  let listCount = 0;
  for (const collector of snapshot.collectors) {
    fileCount += collector.files.length;
    listCount += collector.lists.length;
  }
  return {
    hostname: machine.computerName ?? machine.hostname,
    platform: machine.platform,
    arch: machine.arch,
    username: machine.username,
    collectorCount: snapshot.collectors.length,
    fileCount,
    listCount,
  };
}
