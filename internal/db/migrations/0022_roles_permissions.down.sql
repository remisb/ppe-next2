-- Back to the three fixed role names on each user. Custom roles are lost; a
-- user who held only custom roles becomes an employee, so the CHECK holds.
ALTER TABLE users ADD COLUMN roles TEXT[] NOT NULL DEFAULT '{}';

UPDATE users u SET roles = coalesce((
    SELECT array_agg(r.key ORDER BY r.key) FROM user_roles ur JOIN roles r ON r.id = ur.role_id
    WHERE ur.user_id = u.id AND r.key IS NOT NULL), '{}');
UPDATE users SET roles = ARRAY['employee'] WHERE cardinality(roles) = 0;

ALTER TABLE users ALTER COLUMN roles DROP DEFAULT;
ALTER TABLE users ADD CONSTRAINT users_roles_known CHECK (
    cardinality(roles) > 0
    AND roles <@ ARRAY['admin', 'manager', 'employee']::TEXT[]
);

DROP TABLE user_roles;
DROP TABLE role_permissions;
DROP TABLE roles;
