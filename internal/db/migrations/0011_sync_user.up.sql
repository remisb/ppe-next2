-- The account data synchronization writes as: rows it inserts or updates name
-- this id in their actor columns (created_by_user_id, updated_by_user_id), so
-- synced changes are told apart from people's. The id is fixed so every
-- environment has the same one.
--
-- It cannot sign in: '!' is no bcrypt hash, so no password matches, and it is
-- inactive. Its role is employee, the narrowest that may write employees.
-- ON CONFLICT: a live user may already hold the address; then nothing is added.
INSERT INTO users (id, email, name, password_hash, roles, is_active, created_at, updated_at,
                   created_by_user_id, updated_by_user_id)
VALUES ('5e5c0000-0000-4000-8000-000000000001', 'sync@system.invalid', 'Data synchronization', '!',
        ARRAY['employee'], FALSE, now(), now(),
        '5e5c0000-0000-4000-8000-000000000001', '5e5c0000-0000-4000-8000-000000000001')
ON CONFLICT DO NOTHING;
