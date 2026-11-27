# ADR 0009: App Launcher as a reusable module, embedded in each client's application

- **Status:** accepted (decisions made 2026-11-27); steps 1 to 4 built 2026-11-27 (remisb/PPE-next2#82,
  #83, #84 and the step 4 pull request; `github.com/remisb/applauncher` v0.1.0, and v0.2.0 with the npm
  packages), as "As built" below says
- **Date:** 2026-11-27
- **Scope:** backend (`internal/domain/launcher`, `cmd/api`'s launcher and published-app code,
  migrations 0042 to 0047), frontend (`@ppe/launcher`, `web/apps/launcher`, Administration's Manage
  apps, `@ppe/routing`'s mount helpers), deployment (`deploy/Caddyfile`, the `published` volume,
  `make prod-publish`/`prod-up`), and a new private repository
- **Builds on:** [ADR 0006](0006-app-launcher.md) (App Launcher, hosting tiers by trust, versions
  and channels; every rule there still holds in every host), [ADR 0002](0002-permissions-and-administration-app.md)
  (permissions, not roles), [ADR 0003](0003-audit-integrity-and-retention.md) (the audit trail is
  permanent and its event names never change)
- **Options paper:** the comparison of six packagings (copy, embedded module, a service per client,
  one multi-tenant service, an identity provider's portal, and the hybrid chosen here), with scores
  for reusability, maintenance, security, safety and development and production efficiency, was
  reviewed on 2026-11-27 and is summarised under "Alternatives considered"

## Context

A second client project is starting and should reuse App Launcher: the tile registry people open
at `/apps/`, the **Apps** entry in every app, Administration's **Manage apps**, and the releases
part (published apps' immutable versions, Stable/Beta/Preview channels, Trials). Further clients
may follow.

The client's answers (2026-11-27):

| Question | Answer |
| --- | --- |
| Its stack | Go and React, like this project |
| Versions and channels | needed from the start |
| Sign-in | the application's own, as here (no shared identity provider) |
| UI kit | App Launcher's screens only; `@ppe/ui` is not shared |

What exists (non-test lines, 2026-11-27): the Go domain (2,188, with 1,005 lines of tests), its
wiring in `cmd/api` (`launcher-routes.go`, `published-app-routes.go`, `publish-app.go`: 857),
six migrations (178), `@ppe/launcher` (1,486), the launcher app (678) and Manage apps' screens (959).

The domain already follows the service contract: no `net/http`, permissions read through a
`can func(role.Permission) bool` passed in, one repository. What ties it to this project:

- **Permissions** are `role.Permission`, this project's catalogue (`AnyOf`, `AppsPreview`, `AppsManage`).
- **Audit:** repositories take mutations returning `[]audit.Event` and write them in their own
  transaction with `audit.Insert`.
- **Users:** nine foreign keys to `users (id)`; `TRUNCATE users CASCADE` empties the launcher's
  tables in tests, and `launcher.EnsureDefaults` puts the default tiles back.
- **Default tiles** (`launcher.Defaults`) are this project's apps, with names in exactly three
  languages (`Names{EN, LT, RU}`, three columns).
- **Tables** are in `public`, applied by `make migrate` and `deploy/migrate.sh` with psql;
  `internal/db.Migrations()` lists them for `/ready`.
- **Handlers** use this project's `router` (`rt.restricted`), `writeError`, `actorID`.
- **Trials** combine the launcher's versions and feedback with Usage's `VersionUse`
  (`user_version_activity`) and System's `VersionErrors` (`error_events.app_version`), in the handler.
- **The page server** writes `ppe-mount`, `ppe-files`, `ppe-version`, `ppe-channel` meta tags and
  sends a CSP per profile that `TestPublishedPoliciesMatchCaddy` keeps equal to the Caddyfile's;
  publishing and pruning are `api -publish-app` and `-prune-apps` behind Makefile targets and
  `deploy/build-app.sh`.
- **App identity:** the `X-PPE-App` and `X-PPE-App-Version` headers, the slug rule kept in step
  between Go, `@ppe/api-client`'s `app-slugs.ts` and the Caddyfile.
- **Frontend:** `@ppe/launcher` and the screens depend on `@ppe/ui` (about 25 components),
  `@ppe/app-shell` (session, `can`), `@ppe/i18n` and `@ppe/routing`; the packages export
  TypeScript source, consumed inside this workspace only.

## Decision

1. **One private repository, `remisb/applauncher`** (checked out at `../../remis-libs/applauncher`,
   beside dbbackup and pdf-mini), holding a Go module and npm packages, with an example host
   (a small Go API and React app) for its own tests and e2e. This project becomes its first host.
   Library first: it is code each application builds into itself, not a service it calls.

2. **Embedded in each host.** Every client runs the launcher inside its own API binary, on its
   own database, behind its own sign-in, on its own origin. No launcher process, no shared
   instance, no tenancy. A **service mode** (a `cmd/launcher` binary with token checks by JWKS and
   prebuilt pages, for a host not written in Go) is left out until a client needs it, and then
   decided by a new record. A **multi-tenant** service is not planned: it would put every client
   behind one breach or outage and make the vendor a processor of every client's users.

3. **Layers.** Go packages:
   - `launcher`: entities, rules, the service and the ports below; no storage, no HTTP.
   - `launcher/pgstore`: the Postgres repository in schema **`launcher`**, its migrations as
     plain SQL files (also embedded) with a version table of its own, and `pgstoretest`, the
     conformance tests a host runs against its database.
   - `launcher/launcherhttp`: handlers as `http.Handler`s and their JSON, with the route table
     and each route's required permission key exported so a host mounts them behind its own
     authentication and records them in its own policy tests; its sentinel errors with their
     status codes, for the host's error mapping.
   - `launcher/releases`: versions, channels, per-user choices, Stable follows deploys, Trials,
     the published-app page server, the profiles' CSP and Permissions-Policy, `Publish` and
     `Prune` as functions a host's CLI calls, and a Caddy snippet with the files and page routes.

   npm packages, published as built ESM with types and one compiled CSS file:
   - `@remisb/launcher-core`: types, the API client over a `fetch` the host supplies, the tile,
     audience and channel rules, recent apps per device, `basePath`/`filesBase`, the slug rule.
     No React.
   - `@remisb/launcher-react`: the launcher screen, the **Apps** entry, `ChannelStripe`,
     `AppFrame`, `SignedIn`, and Manage apps (tiles, Versions and channels, Trials, feedback),
     on a small set of its own parts styled by CSS variables named as shadcn's (`--background`,
     `--foreground`, `--primary`, `--muted`, `--border`, `--radius`…), so a shadcn-themed host
     looks the same without sharing `@ppe/ui`. Its words in English, Lithuanian and Russian, which
     a host may override or extend.
   - The published-app template (`make new-app`) moves to the repository as a starter.

4. **Ports the host implements.** The module never reads the host's tables.
   - `Can(ctx, key string) bool`: permissions as plain strings. The host names in `Config` its
     keys for previewing apps in testing and for managing apps (here `apps.preview`, `apps.manage`).
     Tile audiences are lists of the host's keys; a key the host does not know is dropped, as
     `role.Known` does today.
   - `Actor(ctx) uuid.UUID`: the signed-in user.
   - `Auditor.Record(ctx, tx pgx.Tx, events []Event)`: called inside the launcher's transaction.
     This project's adapter writes them to the sealed audit trail with `audit.Insert`, under the
     same event names (`app.*`), which never change (ADR 0003). A host with no audit trail may log them.
   - `TrialStats`: `VersionUse(ctx, slug)` and `VersionErrors(ctx, slug)`; this project adapts
     Usage and System to it, a host without them answers empty maps.
   - `Config`: the languages, the default tiles (`EnsureDefaults(ctx, seed []App)`), the app
     header names, the meta tag prefix, the published files' directory, the profiles a host allows.
     This project's values reproduce today's exactly: `X-PPE-App`, `ppe-` tags, EN/LT/RU.

5. **Identity stays the host's.** The module signs no one in, sets no cookie and holds no key.
   Every host keeps ADR 0006's trust boundary: the origin. A published app's page can get a token
   with all its user's permissions, so only builds from repositories the host's owner reviews are
   published; publishing is a command on the server, never an upload from the browser; a
   channel's audience decides who sees it, not who may open it; only the `device` profile gets
   `'wasm-unsafe-eval'`, workers and the camera. Third-party code would need ADR 0006's sandbox
   tier, which is still not built.

6. **Data.** Users are `uuid.UUID` with **no foreign keys** in the module's migrations; a host may
   add them in its own migration, and this project does, so `TRUNCATE users CASCADE` and actor
   integrity behave as today. `Service.ForgetUser(ctx, user)` removes a user's pins, choices and
   feedback text for erasure. Names become one `jsonb` map per tile (`{"en": …, "lt": …}`), the
   host's languages. In this project one migration moves the six tables into schema `launcher`
   (`ALTER TABLE … SET SCHEMA`, names without the `launcher_` prefix) and merges the name
   columns, with `grants.sql` giving `ppe_app` the same rights there as now.

7. **Compatibility.** Semantic versions with a CHANGELOG; within a major version migrations are
   additive and the JSON is only extended. This project's routes, JSON, event names and
   `X-PPE-App` stay as they are, so `TestRoutePolicy`, the e2e suite, `@ppe/api-client` (whose
   launcher types then come from `@remisb/launcher-core`) and the audit trail see no change. The
   Go module is read as dbbackup and pdf-mini are (`GOPRIVATE`, the `.github-token` build secret,
   CI's read token widened to the new repository); the npm packages come from GitHub Packages with
   a read-only token. During development a host points at the local checkout (`replace` in
   `go.mod`, `link:` in `package.json`); a commit to `main` names a tag.

8. **Built inside this project first.** The ties are cut here, under this project's tests and e2e,
   before any code moves; extraction is then moving packages. Order in Plan.

## Consequences

- A launcher change touches two repositories and needs a tag before this project's `main` uses it.
  The local `replace` and `link:` keep development to one edit; Renovate or Dependabot opens the
  upgrade in each host.
- Builds gain private dependencies: the API image already reads private Go modules with a build
  secret; **the web image gains one** (an `.npmrc` token for `pnpm fetch`), and so does CI's web job.
- `@ppe/launcher` and the launcher app shrink to this project's configuration: its tiles, its
  words where they differ, the mount of `@remisb/launcher-react`. Administration mounts Manage apps
  from the package. Screens look the same; the e2e suite proves it.
- The module's migrations have their own sequence. This project must apply them as the owner in
  the `migrate` step and include them in `/ready` (open question 1).
- `docs/specs/app-launcher.md` moves to the repository as its spec; this project keeps a short
  page on its own configuration and adapters. The handbook stays here.
- Each client keeps its users' launcher data (pins, choices, feedback, version activity) in its own
  database, as controller, with no data shared across clients.
- The slug rule, profiles and their CSP are defined once in the repository, with the tests that
  now keep Go, TypeScript and the Caddyfile in step moving there too; this project keeps
  `TestPublishedPoliciesMatchCaddy` against its own Caddyfile, which imports the snippet.
- Nothing here changes what users see or do: no Help text changes.

## Alternatives considered

- **Copy the code into the new project.** Fastest first delivery, but every fix and security patch
  must be ported by hand, the copies drift, and the decoupling is redone in each. Rejected.
- **A launcher service per client** (its own binary, database schema, launcher page and admin
  console, trusting the client's identity provider's tokens). Fits any stack, but adds a network
  surface, token handling, a second admin and another container per client, for a client on the
  same stack as this one. Kept as the later service mode (decision 2).
- **One multi-tenant service for all clients.** One deployment, but one breach or outage reaches
  every client, tenancy runs through every query, key and log, and the vendor processes every
  client's users. Rejected unless the launcher becomes a product sold with contracts and SLAs.
- **An identity provider's app portal** (authentik's or Keycloak's): lists links by policy but
  has no versions, channels, trials, pins, feedback or shortcuts, and needs another heavy service.
  Rejected.
- **The registry alone, releases later.** Smaller first step, but the client needs versions and
  channels from the start. Rejected for this client; the layers still keep `releases` separable.
- **Sharing `@ppe/ui` as a design kit with the launcher on top.** Less frontend work in the
  package, but a much larger extraction with its own users. Not now; the package's parts follow
  shadcn's token names so a later shared kit can replace them.

## Plan

Each step is one pull request and leaves this project deployable.

1. **Registry, inside this project:** string permission keys behind `Can`; the `Auditor` port and
   this project's adapter; default tiles and languages as configuration; handlers into
   `internal/launcher/launcherhttp`; the schema move migration and grants. All Go, Postgres and
   e2e tests pass unchanged.
2. **Releases, inside this project:** the `TrialStats` port with Usage's and System's adapters; the
   page server, profiles and meta prefix into `internal/launcher/releases`; `Publish` and `Prune`
   called by `api -publish-app` and `-prune-apps`; the Caddy rules as a snippet the Caddyfile imports.
3. **Extract** the Go packages, migrations, snippet, conformance tests and an example host to
   `remisb/applauncher`; this project imports it by `replace`, then by tag; CI and the API image read it.
4. **Frontend packages:** `@remisb/launcher-core` and `@remisb/launcher-react` from `@ppe/launcher`,
   the launcher app and Manage apps, on the package's own parts; built and published to GitHub
   Packages; the web image and CI read them; this project's apps mount them.
5. **The second client** mounts the Go layers with its adapters and tiles, the React packages in its
   apps and admin, the Caddy snippet, and publishes its first app by the recipe.

## As built, steps 1 to 3

- **Layout of v0.1.0** (`github.com/remisb/applauncher`): `launcher` holds the registry, its service
  and its Postgres repository in one package (no `pgstore` split yet); `launcherhttp`, `releases`;
  the root package `applauncher` holds the schema's migrations (`Migrate`, `Migrations`, `SQL`) and
  `CaddySnippet`; `caddy/launcher.caddy`; `example/`, a host to read. Its tests run on a database
  per package (`APPLAUNCHER_TEST_DSN`); its CI runs gofmt, vet, golangci-lint and the tests on Postgres 18.
- **Errors**: the module's own `launcher.Error` of four kinds (`KindInvalid`, `KindNotFound`,
  `KindConflict`, `KindUnauthenticated`) with stable codes; this project maps the kinds in
  `kindStatuses` (`cmd/api/http.go`), and `apperr.CodeOf` reads any error with a `Code()`.
- **Erasure**: `Service.ForgetUser` (pins, channel choices, feedback text) for a host whose users
  do not cascade; this project's foreign keys still cascade pins and choices.
- **Migrations (open question 1), for now:** this project keeps its own migrations of the schema
  (0042 to 0068) and does not call `Migrate`; `TestPostgresLauncherSchemaIsTheModules` checks that
  they make the module's schema, the foreign keys to `users` aside. The first module migration
  after 0001 must answer the question.
- **The Caddy snippet** is copied into `deploy/caddy/launcher.caddy`, kept equal to the module's by
  `TestCaddySnippetIsTheModules`.
- **Still this project's:** the build manifest's name `ppe-app.json` (the module reads it), the
  `ppe-` meta prefix and `X-PPE-App` (configured), and the slug rule's web copy
  (`TestWebClientKeepsTheSlugRule`, now in `cmd/api`).
- Step 1 put `launcherhttp` at `internal/launcher/launcherhttp` (depguard keeps `net/http` out of
  `internal/domain`), and the Trials port came with it rather than in step 2.

## As built, step 4

- **Scope:** the launcher side only. `@remisb/launcher-core` (types, rules, channels, recent apps,
  words) and `@remisb/launcher-react` (`LauncherScreen`, `ChannelStripe`, `TileIcon`,
  `useLauncherList`, on a few parts of its own over the shadcn theme). Manage apps stays in
  Administration on `@ppe/ui`; `AppFrame`, `SignedIn` and `NotForYou` stay in `@ppe/launcher` (this
  site's sign-in), as do `new-app.ts` and `published-apps.ts` (this repository's tooling).
- **Distribution, instead of GitHub Packages:** git dependencies at a tag,
  `git+https://github.com/remisb/applauncher.git#v0.2.0&path:/web/packages/launcher-*`, with `dist/`
  committed (the module's CI checks a build matches it). The same fine-grained token as the Go
  module reads them: CI's web and e2e jobs, and the web image's `pnpm fetch` through the
  `github_token` build secret (also in `deploy/build-app.sh`). No classic `read:packages` token.
- **This site's bindings** in `@ppe/launcher`: the group names (EN, LT, RU), `currentLang()`, the
  `workwear.launcher` device keys, `client.launcher`, the `ppe-*` meta tags, `apps.manage`.
  `AppNames` became a type alias so this site's tiles read as the package's.
- Each app's `index.css` also scans `@remisb/launcher-react`'s `dist` with `@source`, which its
  `tailwind-sources.test.ts` checks.

## Open questions

1. **Running the module's migrations.** `deploy/migrate.sh` runs psql in the Postgres image, and
   `ppe_app` may not run DDL. Recommended: the `migrate` service also runs `api -migrate-modules`
   (the API image, as the owner) after psql, applying `launcher` migrations under an advisory lock;
   `internal/db.Migrations()` and `/ready` include the module's list. Alternative: a make target
   copies the module's SQL into this project's migrations, checked by a test.
2. **Repository and package names:** `remisb/applauncher` and `@remisb/launcher-*` are working names.
3. **Who may read the repository:** only the owner, or also the client's developers (read tokens,
   and a licence stating what the client may do with the code).
