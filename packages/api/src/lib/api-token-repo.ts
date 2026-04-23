// ApiTokenRepo — DbDriver-based access for the `api_tokens` table.
//
// Uses Web Crypto (SubtleCrypto + getRandomValues) so it runs unchanged in
// both Node.js (web_legacy) and Cloudflare Workers (no nodejs_compat needed).
import type { DbDriver } from "./db/driver";

export interface ApiTokenRow {
  id: string;
  // biome-ignore lint/style/useNamingConvention: D1 column name
  token_hash: string;
  // biome-ignore lint/style/useNamingConvention: D1 column name
  token_prefix: string;
  email: string;
  label: string;
  // biome-ignore lint/style/useNamingConvention: D1 column name
  created_at: number;
  // biome-ignore lint/style/useNamingConvention: D1 column name
  last_used_at: number | null;
  // biome-ignore lint/style/useNamingConvention: D1 column name
  expires_at: number | null;
}

export interface PublicApiToken {
  id: string;
  tokenPrefix: string;
  email: string;
  label: string;
  createdAt: number;
  lastUsedAt: number | null;
  expiresAt: number | null;
}

function toPublic(row: ApiTokenRow): PublicApiToken {
  return {
    id: row.id,
    tokenPrefix: row.token_prefix,
    email: row.email,
    label: row.label,
    createdAt: row.created_at,
    lastUsedAt: row.last_used_at,
    expiresAt: row.expires_at,
  };
}

const TOKEN_PREFIX = "otk_";

function bytesToHex(bytes: Uint8Array): string {
  let hex = "";
  for (const b of bytes) hex += b.toString(16).padStart(2, "0");
  return hex;
}

const PLUS_RE = /\+/g;
const SLASH_RE = /\//g;
const TRAILING_EQ_RE = /=+$/;

function bytesToBase64Url(bytes: Uint8Array): string {
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(PLUS_RE, "-").replace(SLASH_RE, "_").replace(TRAILING_EQ_RE, "");
}

export async function hashToken(rawToken: string): Promise<string> {
  const enc = new TextEncoder().encode(rawToken);
  const digest = await crypto.subtle.digest("SHA-256", enc);
  return bytesToHex(new Uint8Array(digest));
}

export function generateRawToken(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return `${TOKEN_PREFIX}${bytesToBase64Url(bytes)}`;
}

export interface CreateTokenInput {
  email: string;
  label?: string;
  expiresAt?: number | null;
  /** Override id generator; defaults to crypto.randomUUID(). */
  id?: string;
  /** Override now(); defaults to Date.now(). */
  now?: number;
}

export interface CreateTokenResult {
  /** Raw token, shown to user exactly once. */
  token: string;
  row: PublicApiToken;
}

export async function createApiToken(
  driver: DbDriver,
  input: CreateTokenInput,
): Promise<CreateTokenResult> {
  const raw = generateRawToken();
  const hash = await hashToken(raw);
  const prefix = raw.slice(0, 12); // "otk_" + 8 chars
  const id = input.id ?? crypto.randomUUID();
  const now = input.now ?? Date.now();
  const label = input.label ?? "CLI";
  const expiresAt = input.expiresAt ?? null;

  await driver.execute(
    `INSERT INTO api_tokens (id, token_hash, token_prefix, email, label, created_at, last_used_at, expires_at)
     VALUES (?1, ?2, ?3, ?4, ?5, ?6, NULL, ?7)`,
    [id, hash, prefix, input.email, label, now, expiresAt],
  );

  return {
    token: raw,
    row: {
      id,
      tokenPrefix: prefix,
      email: input.email,
      label,
      createdAt: now,
      lastUsedAt: null,
      expiresAt,
    },
  };
}

export interface VerifiedToken {
  id: string;
  email: string;
}

export async function verifyApiToken(
  driver: DbDriver,
  rawToken: string,
  now: number = Date.now(),
): Promise<VerifiedToken | null> {
  if (!rawToken) return null;
  const hash = await hashToken(rawToken);
  const row = await driver.queryFirst<ApiTokenRow>(
    `SELECT id, token_hash, token_prefix, email, label, created_at, last_used_at, expires_at
     FROM api_tokens
     WHERE token_hash = ?1 AND (expires_at IS NULL OR expires_at > ?2)`,
    [hash, now],
  );
  if (!row) return null;
  return { id: row.id, email: row.email };
}

export async function touchApiTokenLastUsed(
  driver: DbDriver,
  id: string,
  now: number = Date.now(),
): Promise<void> {
  await driver.execute("UPDATE api_tokens SET last_used_at = ?1 WHERE id = ?2", [now, id]);
}

export async function listApiTokensByEmail(
  driver: DbDriver,
  email: string,
): Promise<PublicApiToken[]> {
  const rows = await driver.query<ApiTokenRow>(
    `SELECT id, token_hash, token_prefix, email, label, created_at, last_used_at, expires_at
     FROM api_tokens WHERE email = ?1 ORDER BY created_at DESC`,
    [email],
  );
  return rows.map(toPublic);
}

export async function revokeApiToken(driver: DbDriver, id: string): Promise<boolean> {
  const result = await driver.execute("DELETE FROM api_tokens WHERE id = ?1", [id]);
  return result.changes > 0;
}
