/**
 * Core type definitions for the Otter backup system.
 *
 * Architecture:
 *   Layer 1 (Collectors) → CollectorResult
 *   Layer 2 (Snapshot)   → Snapshot (unified format)
 *   Layer 2 (Uploader)   → uploads Snapshot to webhook
 */

// ---------------------------------------------------------------------------
// Layer 1: Collector types
// ---------------------------------------------------------------------------

/** Category of data a collector handles */
export type CollectorCategory = "config" | "environment";

/** A single collected file (full content included) */
export interface CollectedFile {
  /** Absolute path on the source machine */
  path: string;
  /** File content as UTF-8 string */
  content: string;
  /** v2 duplicate content references another inline file with this SHA-256 in the same snapshot. */
  contentRef?: string;
  /** File size in bytes */
  sizeBytes: number;
  /** v2: portable location, link structure, and saved-byte integrity. */
  rootId?: string;
  relativePath?: string;
  kind?: "file" | "directory" | "symlink";
  /** Resolved target type, absent for unreadable links. */
  targetKind?: "file" | "directory";
  encoding?: "utf8" | "base64";
  sha256?: string;
  /** Mode of the captured target; POSIX symlink permissions do not control the target. */
  mode?: number;
  entryMode?: number;
  linkTarget?: string;
  resolvedPath?: string;
  links?: { path: string; target: string; resolvedPath: string }[];
  redacted?: boolean;
}

/** A list-only item (e.g., installed apps, brew packages, skills) */
export interface CollectedListItem {
  /** Display name */
  name: string;
  /** Optional version string */
  version?: string;
  /** Optional extra metadata */
  meta?: Record<string, string>;
}

/** Result produced by a single collector */
export interface CollectorResult {
  /** Unique collector identifier, e.g. "claude-config", "homebrew" */
  id: string;
  /** Human-readable label */
  label: string;
  /** Which category this collector belongs to */
  category: CollectorCategory;
  /** Full files collected (config files, dotfiles, etc.) */
  files: CollectedFile[];
  /** List-only items (app names, package lists, skill names) */
  lists: CollectedListItem[];
  /** Errors encountered during collection (non-fatal) */
  errors: string[];
  /** Tools/features that were safely skipped (e.g. "not installed") */
  skipped: string[];
  /** Duration of collection in milliseconds */
  durationMs: number;
  /** Internal collector handoff; promoted to Snapshot.workspace by the builder. */
  workspace?: WorkspaceCapture;
}

/** Interface that every collector must implement */
export interface Collector {
  /** Unique collector identifier */
  readonly id: string;
  /** Human-readable label */
  readonly label: string;
  /** Which category */
  readonly category: CollectorCategory;
  /** Run the collection and return results */
  collect(): Promise<CollectorResult>;
}

// ---------------------------------------------------------------------------
// Layer 2: Snapshot types
// ---------------------------------------------------------------------------

/** Machine metadata captured at snapshot time */
export interface MachineInfo {
  /** Hostname (OS-level, e.g. "xxx.local") */
  hostname: string;
  /** User-friendly computer name (macOS: scutil --get ComputerName) */
  computerName?: string;
  /** OS platform (e.g. "darwin") */
  platform: string;
  /** OS release version */
  osVersion: string;
  /** CPU architecture (e.g. "arm64") */
  arch: string;
  /** Current username */
  username: string;
  /** User home directory */
  homeDir: string;
  /** Node.js version used to run the CLI */
  nodeVersion: string;
}

/** A complete backup snapshot */
export interface Snapshot {
  /** Schema version for forward compatibility */
  version: 1 | 2;
  /** ISO 8601 timestamp of when the snapshot was created */
  createdAt: string;
  /** Unique snapshot identifier (UUIDv4) */
  id: string;
  /** Machine info at time of snapshot */
  machine: MachineInfo;
  /** Results from all collectors */
  collectors: CollectorResult[];
  workspace?: WorkspaceCapture;
}

// ---------------------------------------------------------------------------
// Layer 2: Uploader types
// ---------------------------------------------------------------------------

/** Configuration for the snapshot uploader */
export interface UploaderConfig {
  /** Full URL to POST the snapshot to */
  url: string;
  /** Bearer token sent as `Authorization: Bearer <token>` */
  token: string;
  /** Optional timeout in milliseconds (default: 30000) */
  timeoutMs?: number;
}

/** Result of an upload attempt */
export interface UploadResult {
  /** Whether the upload succeeded */
  success: boolean;
  /** HTTP status code (if request was made) */
  statusCode?: number;
  /** Error message (if failed) */
  error?: string;
  /** Duration of upload in milliseconds */
  durationMs: number;
  receipt?: RemoteReceipt;
}

export type AgentKind = "claude" | "codex" | "grok" | "pi" | "hermes" | "opencode" | "gemini";
export type ResourceKind = "skill" | "instruction" | "command" | "rule" | "hook" | "configuration";

export interface SourceRegistration {
  id: string;
  path: string;
  label: string;
}
export interface WorkspaceRegistry {
  version: 1;
  sources: SourceRegistration[];
  projects: string[];
  bindings: {
    id: string;
    source: string;
    target: string;
    mode: "link" | "copy" | "fork";
    baseSource?: string;
    baseTarget?: string;
    createdAt?: string | number;
  }[];
}
export interface GitObservation {
  checkedAt: string;
  repository: boolean;
  branch?: string;
  commit?: string;
  upstream?: string;
  remote?: string;
  repoKey?: string;
  ahead: number;
  behind: number;
  staged: number;
  unstaged: number;
  untracked: number;
  conflicts: number;
  detached: boolean;
  unborn: boolean;
  remoteCheckedAt?: string;
  fetchError?: string;
  error?: string;
}
export interface CaptureRoot {
  id: string;
  path: string;
  entryPath?: string;
  /** Relative entries selected within the root; omitted when the whole root is captured. */
  include?: string[];
  label: string;
  role: "source" | "agent" | "shared" | "external" | "project";
  agentIds: string[];
  /** Selected project context, including instructions inherited from parent directories. */
  cwd?: string;
  git?: GitObservation;
  status: "complete" | "partial" | "missing";
}
export interface AgentInstallation {
  id: string;
  kind: AgentKind;
  profile: string;
  configPath: string;
  executable?: string;
  version?: string;
  /** Filesystem discovery does not assert loading in an existing session. */
  discovery: "on-disk";
}
export interface WorkspaceResource {
  id: string;
  rootId: string;
  relativePath: string;
  path: string;
  resolvedPath?: string;
  name: string;
  kind: ResourceKind;
  agentIds: string[];
  discovery?: {
    agentId: string;
    state: "on-disk" | "disabled" | "unsupported" | "project-only";
    reason?: string;
    cwd?: string;
  }[];
  sourceId?: string;
  counterpart?: string;
  relationship:
    | "source"
    | "independent"
    | "symlink"
    | "hardlink"
    | "configurationReference"
    | "managedCopy"
    | "sourceChanged"
    | "localChanged"
    | "bothChanged"
    | "fork"
    | "equalContent"
    | "unknownLineage"
    | "broken";
  digest: string;
  fileCount: number;
}
export interface CoverageIssue {
  rootId: string;
  path: string;
  status: "excluded" | "redacted" | "error" | "limit" | "unstable" | "invalid" | "list-only";
  reason: string;
}
export interface WorkspaceCapture {
  schemaVersion: 2;
  deviceId: string;
  observedAt: string;
  contentFingerprint: string;
  configurationFingerprint: string;
  scopeFingerprint: string;
  registry: WorkspaceRegistry;
  roots: CaptureRoot[];
  agents: AgentInstallation[];
  resources: WorkspaceResource[];
  coverage: {
    complete: boolean;
    files: number;
    bytes: number;
    issues: CoverageIssue[];
    policy: {
      version: number;
      maxFileBytes: number;
      maxTotalBytes: number;
      maxEntries: number;
      maxDepth: number;
    };
  };
}
export interface RemoteReceipt {
  snapshotId: string;
  sha256: string;
  receivedAt: string;
  account: string;
}

// ---------------------------------------------------------------------------
// CLI Config types
// ---------------------------------------------------------------------------

/** Persisted CLI configuration (stored at ~/.config/otter/config.json) */
export interface OtterConfig {
  /** Webhook token obtained via `otter login` */
  token?: string;
}
