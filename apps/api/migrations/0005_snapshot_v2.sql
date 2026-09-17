-- Account-scoped immutable snapshot identities and device/recovery summaries.
PRAGMA defer_foreign_keys = ON;
CREATE TABLE snapshots_v2 (
  id TEXT NOT NULL,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  webhook_id TEXT REFERENCES webhooks(id) ON DELETE SET NULL,
  hostname TEXT NOT NULL, platform TEXT NOT NULL, arch TEXT NOT NULL, username TEXT NOT NULL,
  collector_count INTEGER NOT NULL, file_count INTEGER NOT NULL, list_count INTEGER NOT NULL,
  size_bytes INTEGER NOT NULL, r2_key TEXT NOT NULL,
  snapshot_at INTEGER NOT NULL, uploaded_at INTEGER NOT NULL,
  schema_version INTEGER NOT NULL DEFAULT 1,
  device_id TEXT, sha256 TEXT, coverage_complete INTEGER, summary_json TEXT,
  PRIMARY KEY (user_id, id)
);
INSERT INTO snapshots_v2 (id, user_id, webhook_id, hostname, platform, arch, username,
  collector_count, file_count, list_count, size_bytes, r2_key, snapshot_at, uploaded_at)
SELECT id, user_id, webhook_id, hostname, platform, arch, username,
  collector_count, file_count, list_count, size_bytes, r2_key, snapshot_at, uploaded_at FROM snapshots;
DROP TABLE snapshots;
ALTER TABLE snapshots_v2 RENAME TO snapshots;
CREATE INDEX idx_snapshots_uploaded ON snapshots(user_id, uploaded_at DESC, id DESC);
CREATE INDEX idx_snapshots_device ON snapshots(user_id, device_id, snapshot_at DESC);

-- Bounded search chunks keep large workspaces out of the metadata row and list response.
CREATE TABLE snapshot_search (
  user_id TEXT NOT NULL,
  snapshot_id TEXT NOT NULL,
  part INTEGER NOT NULL,
  terms TEXT NOT NULL,
  PRIMARY KEY (user_id, snapshot_id, part),
  FOREIGN KEY (user_id, snapshot_id) REFERENCES snapshots(user_id, id) ON DELETE CASCADE
);
