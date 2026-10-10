-- Equipment Assignments: a fourth built-in role, the only one granting
-- equipment.read, which Equipment & Furniture and who holds each item now
-- need (docs/specs/role-service.md, asset-service.md). No role had it before,
-- so after this migration nobody sees them until an administrator gives
-- someone the role on Users. Same id, name and description as role.builtinRoles.
ALTER TABLE roles DROP CONSTRAINT roles_key_known;
ALTER TABLE roles ADD CONSTRAINT roles_key_known
    CHECK (key IS NULL OR key IN ('admin', 'manager', 'employee', 'equipment'));

INSERT INTO roles (id, key, name, description, created_at, updated_at) VALUES
    ('a0e1d000-0000-4000-8000-000000000004', 'equipment', 'Equipment Assignments',
     'Sees Equipment & Furniture: each item and who holds it.', now(), now());

INSERT INTO role_permissions (role_id, permission) VALUES
    ('a0e1d000-0000-4000-8000-000000000004', 'equipment.read');
