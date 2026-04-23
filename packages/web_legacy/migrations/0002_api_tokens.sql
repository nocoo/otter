-- Migration: 0002_api_tokens
-- Bearer token table for CLI auth (replaces next-auth session for non-browser callers).
-- Tokens are hashed (SHA-256, hex) before storage; raw value shown to user once on creation.

CREATE TABLE IF NOT EXISTS api_tokens (
  id TEXT PRIMARY KEY,
  token_hash TEXT UNIQUE NOT NULL,
  token_prefix TEXT NOT NULL,        -- first 8 chars of raw token, for display only
  email TEXT NOT NULL,
  label TEXT NOT NULL DEFAULT 'CLI',
  created_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000),
  last_used_at INTEGER,
  expires_at INTEGER                  -- nullable; NULL means no expiry
);

CREATE INDEX IF NOT EXISTS idx_api_tokens_token_hash ON api_tokens(token_hash);
CREATE INDEX IF NOT EXISTS idx_api_tokens_email ON api_tokens(email);
