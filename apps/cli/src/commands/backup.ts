// Shared backup wiring — resolves upload targets from CLI config so that
// `otter backup` uses the same URL + Bearer token no matter which caller
// invokes it. Kept as a pure function to make it easy to unit-test that a
// freshly-minted token flows through to the two upload endpoints.
import { buildApiBaseUrl } from "./login.js";

export interface BackupConfig {
  /** Bearer api_token (otk_...) from `otter login`. */
  token: string;
}

export interface BackupTargets {
  /** Absolute URL for POST /api/snapshots. */
  snapshotUrl: string;
  /** Absolute URL for POST /api/icons. */
  iconsUrl: string;
  /** Bearer token forwarded to both endpoints via Authorization header. */
  token: string;
}

/**
 * Resolve the upload URLs and Bearer token used by `otter backup`.
 *
 * The API base comes from OTTER_API_URL when set (surety mode / staging)
 * and falls back to the production Worker.
 */
export function resolveBackupTargets(config: BackupConfig): BackupTargets {
  const apiBase = buildApiBaseUrl();
  return {
    snapshotUrl: `${apiBase}/api/snapshots`,
    iconsUrl: `${apiBase}/api/icons`,
    token: config.token,
  };
}
