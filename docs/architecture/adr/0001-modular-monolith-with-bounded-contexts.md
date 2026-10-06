# ADR 0001: Bounded contexts in a modular monolith, one staff app of modules

- **Status:** proposed
- **Date:** 2026-10-06
- **Scope:** backend (Go API, Postgres), frontend (`web/`), deployment

## Context

PPE-next2 orders and tracks workwear and keeps a list of employees. Two areas are to be
added:

1. **Personnel and HR**: employees' certificates and qualifications with their expiry, and
   personal documents and IDs.
2. **Clients and projects**: clients, projects, teams and crews, project management and
   timesheets.

The question is whether to build them as separate small services, each with its own
frontend or behind one combined frontend, or as parts of the existing system. The goals
are reusability, scalability, maintainability and safety.

Facts that bear on it:

- The system is one Go binary (~17k lines) on stdlib `net/http`, one Postgres, one React
  app (~19k lines), deployed with compose on one droplet behind Caddy, built and run by
  one developer.
- It is already modular: no `internal/domain` package imports another; cross-domain calls
  go through interfaces declared by the consumer and adapters in `cmd/api/checkers.go`
  ([domain-service-contract.md](../../domain-service-contract.md)).
- Key invariants rely on one database transaction: an order, its immutable snapshot lines
  and its audit event commit together. Timesheet approval and crew assignment will need
  the same.
- The staff app has a large shared shell: Main nav reshaped per breakpoint, ⌘K, Help per
  role and device, three languages, density, theme, an HttpOnly refresh session and a
  Content-Security-Policy that allows exactly one inline script by hash.
- The new HR data includes special-care personal data (ID numbers, document scans) under
  GDPR, which today's design (soft delete forever, append-only audit with before/after
  JSONB, a data sync that writes tables directly) does not yet handle.
- Load is small: tens to a few hundred employees, a handful of staff users, field workers
  later. Throughput is not the constraint; correctness, data protection and the cost of
  change are.

## Decision

### Backend

Build every area as a **bounded context inside the one API binary and one Postgres
cluster** (a modular monolith), with boundaries enforced strongly enough that any context
can be extracted into its own service when one of the [triggers](#extraction-triggers)
occurs. The contexts, what they own and how they relate are in the
[context map](../context-map.md).

1. **Layout.** `internal/<context>/<module>/` (e.g. `internal/competence/certificate`),
   each module keeping the five-file layout of the domain-service contract. Shared
   infrastructure moves to `internal/platform/` (iam, audit, files, outbox, httpx). The
   composition root stays `cmd/api`, with one `wire_<context>.go` per context instead of
   a growing `checkers.go`.
2. **Boundaries are tested.** An architecture test walks Go imports and fails when a
   context imports another context's package; only `internal/platform` is shared.
3. **One schema and one database role per context.** The API opens one pool per role, so a
   context cannot read another's tables even by mistake. Reporting gets a `SELECT`-only
   role on views. Personnel files' role is granted to nothing else. Foreign keys cross a
   boundary only into the shared kernel (`people.employees`) and actor columns
   (`iam.users`). New contexts start in their own schema; existing tables move with
   `ALTER TABLE ... SET SCHEMA` when their context is reorganised. Migrations stay one
   numbered sequence, named by context (`0023_competence_certificates.up.sql`).
4. **People is the shared kernel.** A person's identity and employment move out of
   today's `employees` into a People context; Workwear keeps the sizes as a wearer
   profile. Users can be linked to an employee for self-service.
5. **Integration.** Synchronous reads through consumer-declared interfaces, as today.
   Reactions through a **transactional outbox**: the event is written in the same
   transaction as the change, a worker (`api -worker`, the same image) delivers it at
   least once, and handlers are idempotent.
6. **Authorization becomes permission-based and scoped.** Roles become named bundles of
   permissions per context (`personnel.documents.read`, `time.approve`, ...), checked at
   the route (pinned in `routes_test.go`, as today) and, for record-level scope (own
   projects, own crew, own records), in the service, which receives an
   `Actor{ID, Permissions, Scopes}` instead of a bare user ID. Personnel files may add
   Postgres row-level security as a second layer.
7. **Access tokens are signed with EdDSA**, the private key held only by the iam module,
   so code that verifies a token cannot mint one. This replaces HS256 with a shared
   secret, and is required before any extraction.

### Frontend

**One staff app, built as a shell with one module per context**, lazy-loaded per route.
A module declares routes, Main nav entries, ⌘K commands, i18n namespaces and Help sections
in a manifest gated by permission, and the shell assembles them. Shared code moves to
packages: `ui` (shadcn components, `Table stack`), `i18n`, `app-shell` (session, theme,
density, shortcuts) and one `api-client` per context, whose types are generated from the Go
structs (or an OpenAPI document) rather than written by hand. Lint rules forbid one module
importing another's internals.

**Separate apps only for a different audience or trust level**, reusing the packages: the
public confirmation page (today a route rendered before the sign-in gate), and later a
crew self-service PWA for field workers (hours, own certificates, own workwear).

### Data protection for HR

Personnel files and Competence follow these rules from their first migration:

- Collect the minimum: an expiry date and "verified by, on" instead of a scan unless a
  scan is required; ID numbers only with a recorded legal basis.
- Files live in object storage (Spaces), never on the droplet disk or in Postgres, with
  envelope encryption: a data key per file, wrapped by a key held outside the database.
  ID-number columns are encrypted by the application.
- Files are streamed through the API (same origin, so the CSP is unchanged) with
  `Content-Disposition: attachment`, a checked content type and size limit, EXIF stripped,
  and never served as SVG or HTML.
- Reads of Personnel files are audited, need a recent sign-in, and HR roles need a second
  factor.
- Audit events for these contexts name fields and IDs only, never values: `audit_events`
  is append-only and could not be erased.
- Each document type has a retention period; after it a purge job hard-deletes the file
  and its row or destroys its key (crypto-shredding). This is an explicit exception to
  "soft delete everywhere", and backup retention is aligned with it.
- A data protection impact assessment and a record of processing exist before HR data is
  collected in production.

### Extraction triggers

A context is extracted into its own service only when at least one holds:

- a different team owns it and needs its own release cadence;
- it needs a different availability or scaling profile (e.g. hundreds of field workers
  submitting hours at once, with offline sync);
- an auditor, client contract or law requires physical isolation of its data (most likely
  Personnel files);
- it is to be sold or reused as a product on its own.

Extraction then means: its schema moves to its own database, the outbox feeds a broker,
consumer interfaces get an HTTP adapter, and it verifies EdDSA tokens with the public key.

## Options considered

### Backend

| | Modular monolith, no extraction plan | **Modular monolith, extract on trigger (chosen)** | Microservices now |
| --- | --- | --- | --- |
| Transactions and invariants | one ACID transaction | one ACID transaction | sagas, outbox everywhere, eventual consistency |
| Operations | one API, one migration run, one backup | the same, plus a worker mode | N images, migration runs and backups; service-to-service auth, tracing, versioned APIs |
| Safety | one process and one DB login see all data | a DB role per schema limits what a bug or leaked credential reaches | a smaller blast radius per service, but more endpoints, secrets and network paths to secure |
| Reuse | Go packages | packages, promoted to `remis-libs` when a second product needs them | network APIs, costlier to change |
| Maintainability | cheap refactoring, but boundaries erode | cheap refactoring, boundaries tested | contract changes across services and repos |
| Scalability | vertical, plus stateless API instances | the same, plus extracting a hot context | per-service scaling not needed at this load |
| Main risk | a big ball of mud | discipline to keep schemas and roles separate | a distributed monolith if boundaries are wrong |

Microservices are rejected for now: their benefit is independent teams and independent
scaling, neither of which this system has, and their cost (distributed transactions,
operations, more attack surface) lands on one developer.

### Frontend

| | **One shell, modules (chosen)** | One SPA per context, one origin | Micro-frontends (Module Federation) |
| --- | --- | --- | --- |
| Consistent shell (nav, ⌘K, Help, i18n) | built once | duplicated or packaged; full reload between apps | shared at runtime; version skew |
| Bundle | code-split per module | small per app | small, plus a federation runtime |
| CSP and session | one script hash, one refresh | one hash per `index.html`, a refresh per app load | harder CSP, one shared React required |
| Deploy | one | independent | independent |
| Tests and Help | one suite, specs per context | repeated per app | hardest |

## Consequences

Positive:

- The existing patterns (domain-service contract, consumer interfaces, audited mutations,
  route policy test, snapshots) carry over unchanged to the new contexts.
- Cross-context features are queries, not distributed calls: crew eligibility from
  Competence and Workwear, dashboards across contexts.
- One deployment, backup and restore keep operations within what one person can run.
- HR data is isolated by database role and encryption from the first migration, and can
  be moved to its own service and database without remodelling.

Negative, and what is done about it:

- Boundaries hold only while enforced: the architecture test, per-schema roles and lint
  rules are part of the first slice, not later.
- One process failure stops every context; acceptable at this size, and the worker runs
  separately so background jobs cannot block requests.
- A pool per role uses more Postgres connections; pool sizes are set per context.
- Moving existing tables into schemas and splitting `employees` touch working code; they
  are done as mechanical, separately tested steps, and the API paths stay the same.

Changes to existing code this decision requires:

- `users.roles` (a `CHECK` on three role names) becomes roles mapped to permissions.
- HS256 access tokens become EdDSA.
- The login rate limiter (`cmd/api/login-limit.go`, in memory) moves to Postgres before a
  second API instance runs.
- The data sync stops writing tables as the sync user and imports through an API, or at
  least through a role limited to the People schema.
- The single serial e2e spec (`web/e2e/tests/order-lifecycle.spec.ts`) gets sibling specs
  per context with their own seed data.
- `packages/api-client/src/types.ts` is generated instead of hand-written.

## Plan

1. **Foundations**: move packages into contexts and `internal/platform`; architecture
   test; schemas and roles; permissions and EdDSA; outbox and worker; Files; the frontend
   shell with module manifests and `packages/ui`; link users to employees.
2. **People and Competence**: split People from `employees`; certificate types,
   certificates with evidence files, the expiry dashboard and reminders.
3. **Personnel files**: encryption, read audit, retention and purge, second factor for HR.
4. **Projects & crew**: clients, sites, projects and requirements, teams, crew
   assignments with eligibility.
5. **Timesheets**: entries, approval, period locking, corrections, export; the crew PWA.

Each step starts with its product contract and `docs/specs/` entry, adds its terms to
[ubiquitous-language.md](../../ubiquitous-language.md) and its rules to
[testing.md](../../testing.md). Steps 1 and 2 change nothing users see in Workwear
except where People replaces Employees.
