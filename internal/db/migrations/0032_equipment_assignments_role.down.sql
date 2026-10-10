DELETE FROM user_roles WHERE role_id = 'a0e1d000-0000-4000-8000-000000000004';
DELETE FROM role_permissions WHERE role_id = 'a0e1d000-0000-4000-8000-000000000004' OR permission = 'equipment.read';
DELETE FROM roles WHERE id = 'a0e1d000-0000-4000-8000-000000000004';

ALTER TABLE roles DROP CONSTRAINT roles_key_known;
ALTER TABLE roles ADD CONSTRAINT roles_key_known CHECK (key IS NULL OR key IN ('admin', 'manager', 'employee'));
