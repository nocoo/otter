-- Migrate legacy Google-OAuth `sub` claims (e.g. "103048496470438908451") used as
-- user_id everywhere to the user's email, which is what @otter/api now reads from
-- the auth context (`auth.email`).
--
-- D1 enforces foreign keys, but PRAGMA defer_foreign_keys lets us reorder updates
-- within the implicit transaction the migration file runs as: rewrite children
-- first while the users.id mapping is still resolvable, then update users last.

PRAGMA defer_foreign_keys = ON;

UPDATE webhooks
SET user_id = (SELECT email FROM users WHERE users.id = webhooks.user_id)
WHERE user_id IN (SELECT id FROM users WHERE id != email);

UPDATE snapshots
SET user_id = (SELECT email FROM users WHERE users.id = snapshots.user_id)
WHERE user_id IN (SELECT id FROM users WHERE id != email);

UPDATE users
SET id = email
WHERE id != email;
