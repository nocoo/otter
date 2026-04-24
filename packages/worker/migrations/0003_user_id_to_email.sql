-- Migrate legacy Google-OAuth `sub` claims (e.g. "103048496470438908451") used as
-- user_id everywhere to the user's email, which is what @otter/api now reads from
-- the auth context (`auth.email`).
--
-- Order matters: rewrite children that reference users.id first while the old
-- mapping is still resolvable, then update users.id last. SQLite/D1 do not enforce
-- foreign keys by default, so updates pass even if children temporarily point at
-- the new id before users.id catches up.

UPDATE webhooks
SET user_id = (SELECT email FROM users WHERE users.id = webhooks.user_id)
WHERE user_id IN (SELECT id FROM users WHERE id != email);

UPDATE snapshots
SET user_id = (SELECT email FROM users WHERE users.id = snapshots.user_id)
WHERE user_id IN (SELECT id FROM users WHERE id != email);

UPDATE users
SET id = email
WHERE id != email;
