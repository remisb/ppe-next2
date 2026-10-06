# ADR 0002: Editable roles of permissions, and Administration as its own app

- **Status:** accepted
- **Date:** 2026-10-06
- **Scope:** backend (Go API, Postgres), frontend (`web/`), deployment
- **Builds on:** [ADR 0001](0001-modular-monolith-with-bounded-contexts.md), item 6 and Frontend

## Context

Access was three fixed role names (`admin`, `manager`, `employee`) in `users.roles`, a
CHECK on them, the JWT `roles` claim, and route groups in `cmd/api/router.go`. Administrators
need to decide what each kind of user may do, and to manage users, roles and the
organisation's settings in an app of their own that looks like the staff app.

Two questions: should role and permission management be a separate backend service, and
should Administration be a separate web app when ADR 0001 chose one staff app of modules?

## Decision

1. **No separate service.** Roles live in this API and database, beside users and
   sessions (`internal/domain/role`, migration 0022). ADR 0001's extraction triggers (a
   different team, a different scaling profile, a legal isolation requirement, a product of
   its own) do not hold for it; keeping it here keeps role changes, user changes and their
   audit in one transaction, and the route-policy test covering every route.
2. **Permissions are a fixed catalogue in code; roles are data.** A route requires one
   permission (`resource.action`). A role bundles permissions; a user holds roles
   (`user_roles`) and may do what any of them allows. Administrators add, change and delete
   roles; they never grant a permission to a user directly. The built-in Administrator,
   Manager and Employee are installed reproducing the old access exactly
   (`TestSeededRolesKeepPolicy`). Administrator cannot change and someone active always
   holds it. Only `roles.manage` grants any permission; anyone else gives only what they
   hold.
3. **The token carries permissions** (`perms`), read from the database at sign-in and
   every refresh, so a change reaches users within minutes. The routes that manage users
   and roles also read the actor's current permissions, so a demotion takes effect there at
   once. muxstack's Authorizer is reused unchanged: the token's permissions stand where it
   expects roles, and each route names exactly one.
4. **Administration is a separate app on the same origin** (`web/apps/admin`, at `/admin/`).
   ADR 0001 allows separate apps "for a different audience or trust level"; administration
   is the trust-level case: few users, sensitive actions, a screen set unlike the staff
   app's. Same origin means one sign-in (the refresh cookie, its Web Lock and the
   sign-out channel are shared), one CSP (the two `index.html` share one inline script) and
   no CORS. Users, Roles & permissions, Settings and Backups moved there; the administrator's
   Dashboard stayed in the staff app, because it is a view of workwear's work, not
   administration.
5. **The apps share packages, not copies**: `@ppe/ui` (components, tokens, styles),
   `@ppe/app-shell` (sign-in, session, permissions, theme, router), `@ppe/i18n` (the language
   machinery and per-package dictionaries) and `@ppe/backups`. This is the package split ADR
   0001 planned for its module shell; module manifests are left for when a second context
   arrives.

## Consequences

- `users.roles` and its CHECK are gone; `user_roles` holds assignments and a down migration
  restores the three names (custom roles are lost).
- Tests and e2e that empty `users` (which cascades to `roles` through the actor keys) put
  the built-in roles back with `role.EnsureBuiltins`; `-seed-admin` calls it.
- A new permission is a constant in `permission.go`, the same key in `permissions.ts`
  (a Go test compares them), and its words in Administration's `roles` dictionaries (typed
  per permission). A new route names its permission in `routes_test.go`'s policy.
- Moving between the apps is a full page load. Administration has no Help of its own: the
  staff app's Help describes it (sections Administration, Users, Roles & permissions,
  Settings and Backups), and `pnpm guide` takes those screenshots at `/admin/`.
- Access tokens stay HS256 for now; ADR 0001's move to EdDSA is still required before any
  context is extracted.
