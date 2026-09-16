-- Make snapshots.webhook_id nullable.
--
-- Bearer-token uploads via /api/snapshots (CLI `otter login` → `otter backup`)
-- are not associated with any webhook row. The original NOT NULL constraint
-- was also self-contradictory with `ON DELETE SET NULL`.
--
-- SQLite can't ALTER column constraints, so we rebuild the table. We keep the
-- FK + `ON DELETE SET NULL` behavior for webhook-token uploads and drop the
-- NOT NULL so Bearer inserts can pass NULL.

PRAGMA defer_foreign_keys = ON;

CREATE TABLE snapshots_new (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  webhook_id TEXT REFERENCES webhooks(id) ON DELETE SET NULL,
  hostname TEXT NOT NULL,
  platform TEXT NOT NULL,
  arch TEXT NOT NULL,
  username TEXT NOT NULL,
  collector_count INTEGER NOT NULL,
  file_count INTEGER NOT NULL,
  list_count INTEGER NOT NULL,
  size_bytes INTEGER NOT NULL,
  r2_key TEXT NOT NULL,
  snapshot_at INTEGER NOT NULL,
  uploaded_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000)
);

INSERT INTO snapshots_new (
  id, user_id, webhook_id, hostname, platform, arch, username,
  collector_count, file_count, list_count, size_bytes, r2_key,
  snapshot_at, uploaded_at
)
SELECT
  id, user_id, webhook_id, hostname, platform, arch, username,
  collector_count, file_count, list_count, size_bytes, r2_key,
  snapshot_at, uploaded_at
FROM snapshots;

DROP TABLE snapshots;
ALTER TABLE snapshots_new RENAME TO snapshots;

CREATE INDEX IF NOT EXISTS idx_snapshots_user_id ON snapshots(user_id);
CREATE INDEX IF NOT EXISTS idx_snapshots_uploaded_at ON snapshots(uploaded_at DESC);
