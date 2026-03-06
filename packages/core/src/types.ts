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
  /** File size in bytes */
  sizeBytes: number;
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
  /** Duration of collection in milliseconds */
  durationMs: number;
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
  version: 1;
  /** ISO 8601 timestamp of when the snapshot was created */
  createdAt: string;
  /** Unique snapshot identifier (UUIDv4) */
  id: string;
  /** Machine info at time of snapshot */
  machine: MachineInfo;
  /** Results from all collectors */
  collectors: CollectorResult[];
}

// ---------------------------------------------------------------------------
// Layer 2: Uploader types
// ---------------------------------------------------------------------------

/** Configuration for the webhook uploader */
export interface UploaderConfig {
  /** Webhook URL to POST the snapshot to */
  webhookUrl: string;
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
}

// ---------------------------------------------------------------------------
// CLI Config types
// ---------------------------------------------------------------------------

/** Persisted CLI configuration (stored at ~/.config/otter/config.json) */
export interface OtterConfig {
  /** Webhook URL for uploads */
  webhookUrl?: string;
  /** R2 endpoint for icon uploads */
  iconR2Endpoint?: string;
  /** R2 access key ID for icon uploads */
  iconR2AccessKeyId?: string;
  /** R2 secret access key for icon uploads */
  iconR2SecretAccessKey?: string;
  /** R2 bucket name for icon uploads */
  iconR2Bucket?: string;
  /** R2 public domain for icon URLs (e.g. "https://s.zhe.to") */
  iconR2PublicDomain?: string;
}
