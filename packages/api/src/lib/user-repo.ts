// UserRepo — SQL access for the `users` D1 table.
//
// Post-0003 migration, users.id == users.email, so any authenticated caller
// (CF Access, /api/auth/cli, or the dev@localhost auto-stamp) has an email
// that IS also their user_id. Downstream tables (webhooks, snapshots) have
// FK constraints against users(id), so we must upsert the row before any
// insert that references it.
import type { DbDriver } from "./db/driver";

/**
 * Idempotently insert a users row keyed by email so downstream FK inserts
 * (webhooks.user_id, snapshots.user_id) succeed for first-time callers.
 */
export async function ensureUser(driver: DbDriver, email: string): Promise<void> {
  await driver.execute(
    `INSERT INTO users (id, email) VALUES (?1, ?1)
     ON CONFLICT(id) DO NOTHING`,
    [email],
  );
}
