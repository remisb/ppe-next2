DELETE FROM user_roles WHERE role_id = 'a0e1d000-0000-4000-8000-000000000006';
DELETE FROM role_permissions WHERE role_id = 'a0e1d000-0000-4000-8000-000000000006' OR permission LIKE 'personnel.%';
DELETE FROM roles WHERE id = 'a0e1d000-0000-4000-8000-000000000006';
ALTER TABLE roles DROP CONSTRAINT roles_key_known;
ALTER TABLE roles ADD CONSTRAINT roles_key_known
    CHECK (key IS NULL OR key IN ('admin', 'manager', 'employee', 'equipment', 'testers'));

ALTER TABLE employees DROP COLUMN birth_date, DROP COLUMN nationality, DROP COLUMN sex;

DROP SCHEMA personnel CASCADE;
