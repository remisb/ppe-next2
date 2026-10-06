-- Roles become rows: a role is a named bundle of permissions, and a user holds
-- roles through user_roles. Permissions are a fixed catalogue in code
-- (internal/domain/role/permission.go); role_permissions only checks a key's
-- shape, and the API drops a key the code does not know. The three built-in
-- roles keep their fixed ids and reproduce the access the three fixed role
-- names gave (role/builtin.go holds the same sets; a test compares them).
CREATE TABLE roles (
    id                 UUID PRIMARY KEY,
    -- admin, manager or employee for a built-in role; NULL for one an
    -- administrator added.
    key                TEXT UNIQUE,
    name               TEXT NOT NULL,
    description        TEXT NOT NULL DEFAULT '',
    created_at         TIMESTAMPTZ NOT NULL,
    updated_at         TIMESTAMPTZ NOT NULL,
    deleted_at         TIMESTAMPTZ,
    -- NULL only on built-in roles, which this migration (or -seed-admin) creates.
    created_by_user_id UUID REFERENCES users (id),
    updated_by_user_id UUID REFERENCES users (id),
    deleted_by_user_id UUID REFERENCES users (id),

    CONSTRAINT roles_key_known CHECK (key IS NULL OR key IN ('admin', 'manager', 'employee')),
    CONSTRAINT roles_actor_required CHECK (
        key IS NOT NULL OR (created_by_user_id IS NOT NULL AND updated_by_user_id IS NOT NULL)
    ),
    CONSTRAINT roles_builtin_live CHECK (key IS NULL OR deleted_at IS NULL),
    CONSTRAINT roles_deletion_pair CHECK ((deleted_at IS NULL) = (deleted_by_user_id IS NULL))
);

CREATE UNIQUE INDEX roles_name_live_idx ON roles (lower(name)) WHERE deleted_at IS NULL;

CREATE TABLE role_permissions (
    role_id    UUID NOT NULL REFERENCES roles (id),
    permission TEXT NOT NULL CONSTRAINT role_permissions_permission_format
        CHECK (permission ~ '^[a-z_]+(\.[a-z_]+)+$'),
    PRIMARY KEY (role_id, permission)
);

CREATE TABLE user_roles (
    user_id UUID NOT NULL REFERENCES users (id),
    role_id UUID NOT NULL REFERENCES roles (id),
    PRIMARY KEY (user_id, role_id)
);

CREATE INDEX user_roles_role_idx ON user_roles (role_id);

INSERT INTO roles (id, key, name, description, created_at, updated_at) VALUES
    ('a0e1d000-0000-4000-8000-000000000001', 'admin', 'Administrator',
     'Manages users, plus everything a manager can do.', now(), now()),
    ('a0e1d000-0000-4000-8000-000000000002', 'manager', 'Manager',
     'Manages Item Catalogue prices and Item Sets, plus everything an employee can do.', now(), now()),
    ('a0e1d000-0000-4000-8000-000000000003', 'employee', 'Employee',
     'Prepares orders and follows them in Orders, manages employees and sizes.', now(), now());

INSERT INTO role_permissions (role_id, permission)
SELECT 'a0e1d000-0000-4000-8000-000000000001'::uuid, p FROM unnest(ARRAY[
    'users.read', 'users.manage', 'roles.manage', 'settings.manage', 'backups.read',
    'employees.delete', 'catalogue.manage', 'item_sets.manage', 'dashboard.overview']) AS p
UNION ALL
SELECT 'a0e1d000-0000-4000-8000-000000000002'::uuid, p FROM unnest(ARRAY[
    'users.read', 'employees.delete', 'catalogue.manage', 'item_sets.manage', 'orders.delete',
    'dashboard.manager']) AS p
UNION ALL
SELECT 'a0e1d000-0000-4000-8000-000000000003'::uuid, 'dashboard.employee';

-- Every user, deleted ones and the sync user included, keeps the roles they had.
INSERT INTO user_roles (user_id, role_id)
SELECT u.id, r.id FROM users u CROSS JOIN LATERAL unnest(u.roles) AS k JOIN roles r ON r.key = k;

ALTER TABLE users DROP CONSTRAINT users_roles_known;
ALTER TABLE users DROP COLUMN roles;
