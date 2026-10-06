# Role service

Roles and the permissions they bundle. Package `internal/domain/role`, routes in
`cmd/api/role-routes.go`, tables from migration `0022_roles_permissions`. Users hold roles
through `user_roles` (the user service writes it). The screen is Roles & permissions in
Administration (`web/apps/admin`, `/admin/roles`).

## Permissions

A fixed catalogue in code (`permission.go`: key, group, requirements), in display order;
`web/packages/api-client/src/permissions.ts` lists the same keys in the same order
(`TestWebClientListsTheCatalogue`). A key is `resource.action`, names what it grants (never
a role) and never changes: a retired permission is removed by a migration that deletes its
rows. `role_permissions` checks only a key's shape; the API drops keys the code does not
know. A permission may require others (`users.manage` and `roles.manage` need
`users.read`); a role holding one without its requirements is refused (400, naming them).

Routes and the built-in roles' permissions: `docs/specs/user-service.md#permissions`.

## Entity

| Field | Notes |
| --- | --- |
| `id` | UUID; the built-ins have fixed ids (`role.AdminID`, `ManagerID`, `EmployeeID`) |
| `key` | `admin`, `manager` or `employee` on a built-in role, `null` otherwise |
| `name` | Required, ≤ 100 characters; unique among live roles, case-insensitively |
| `description` | ≤ 500 characters |
| `permissions` | Known keys, in catalogue order |
| `locked` | Derived: true on Administrator |
| `user_count` | Derived: live users holding the role |
| actor + timestamp columns | Per the domain contract; NULL actors only on built-ins |

## Rules

- **Built-in roles** exist in every database (migration 0022; `role.EnsureBuiltins` puts
  them back after a test or e2e run empties the tables, and `-seed-admin` calls it).
  Installed, they reproduce the access the three fixed roles gave (`builtin.go`;
  `TestSeededRolesKeepPolicy`, `TestPostgresBuiltinsMatchCode`).
- **Administrator** cannot be changed or deleted (409); it holds `users.manage` and
  `roles.manage`, and at least one active user always holds it (user service), so someone
  can always manage users and roles. **Manager** and **Employee** keep their names and descriptions (the apps
  translate them by key) and cannot be deleted; their permissions can change.
- A role a live user holds is not deleted (409); deletion is soft, and frees the name.
- **No escalation.** Only whoever holds `roles.manage` grants any permission. Anyone else
  adds, changes, gives or takes away only permissions they hold themselves
  (`role.MayGrant`, 403). No one takes `users.manage` or `roles.manage` from themselves,
  through a role they hold (400) or their own roles (user service).
- Changes reach users at their next token refresh (minutes); the routes that manage users
  and roles also check the actor's current permissions in the database (below).
- Audit, in the same transaction: `role.created`, `role.updated` (when something changed),
  `role.deleted`, each with `{name, description, permissions}` before and after.
- Concurrency: an update or delete locks the role `FOR UPDATE` and reads its user count
  under the lock; giving a user a role locks it `FOR SHARE`, so the two serialise.

## Access

| Route | Access | Kind |
| --- | --- | --- |
| `GET /api/v1/permissions` | `users.read` | `[{key, group, requires}]` in catalogue order; labels are the apps' |
| `GET /api/v1/roles` | `users.read` | live roles, built-ins first (admin, manager, employee), then by name |
| `GET /api/v1/roles/{id}` | `users.read` | one role, 404 on miss |
| `POST /api/v1/roles` | `roles.manage`, sensitive | body `{name, description, permissions}`; 201 with `Location` |
| `PUT /api/v1/roles/{id}` | `roles.manage`, sensitive | full replace; Administrator 409, a built-in's new name or description 400 |
| `DELETE /api/v1/roles/{id}` | `roles.manage`, sensitive | 204; a built-in or a held role 409 |

`id`, `key`, `locked`, `user_count`, timestamps and actors are refused in request bodies.
**Sensitive** (`requireSensitive` in `cmd/api/auth-routes.go`, also on every user change):
the password entered within `API_RECENT_SIGN_IN` (403 `recent sign-in required`), and the
actor's roles still granting the permission now, read from the database (403 `forbidden:
your roles no longer allow this`), so a demoted administrator is refused before their
token runs out.
