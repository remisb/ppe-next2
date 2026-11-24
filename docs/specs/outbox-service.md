# Outbox service (Events & jobs)

A queue of jobs in Postgres and the worker that runs them: work that must happen because of a
change, but not inside the request that made it (reading a file's text, archiving a record as a
PDF, converting a DOCX). Decisions in [ADR 0008](../architecture/adr/0008-document-vault.md) (9)
and [ADR 0001](../architecture/adr/0001-modular-monolith-with-bounded-contexts.md) (reactions
through a transactional outbox); its first user is [vault-service.md](vault-service.md).

**Status: decided, not built** (phase 4).

- **Package:** `internal/outbox` (platform: imports no domain). Handlers live with their
  context (`internal/vault/extract`, …) and are registered by kind in `cmd/api/worker.go`.
- **Migration:** `0064_outbox`: schema `outbox`, tables `outbox.jobs` and `outbox.workers`.
- **Binary:** the API's own, `api -worker`; image **docworker** (a target of the root
  `Dockerfile`).

## Job (`outbox.jobs`)

| Column | Notes |
| --- | --- |
| `id` | UUID |
| `kind` | `vault.extract_text`, `vault.archive`, `vault.render_docx`, … |
| `key` | what the job is about (a version's id, `asset_assignment:<id>`); with `kind`, unique among live jobs (`pending`, `running`), so enqueuing twice is one job |
| `payload` | JSONB, ids only: never personal data, file contents or text |
| `state` | `pending`, `running`, `done`, `failed` |
| `attempts`, `max_attempts` | 0; 5 by default |
| `run_after` | when it may run next |
| `lease_until`, `worker` | while running |
| `last_error` | a code and a short message from the handler, never text from a file |
| `created_at`, `finished_at` | |

`ppe_app` may insert, select and update; not delete (the purge is an owner's function).

## Rules

- **Enqueue in the transaction.** `outbox.Insert(ctx, tx, kind, key, payload)` writes the job
  with the change that causes it, so a job exists if and only if the change committed. A
  best-effort `outbox.Enqueue(ctx, kind, key, payload)` outside a transaction exists for after-
  commit hooks (archiving, ADR 0008 decision 10). Both `NOTIFY outbox` after commit.
- **Claim.** A worker takes the oldest due job of the kinds it serves:
  `UPDATE … WHERE id = (SELECT id … WHERE state = 'pending' AND run_after <= now() AND kind = ANY($kinds) ORDER BY run_after FOR UPDATE SKIP LOCKED LIMIT 1)`,
  setting `running`, `lease_until` (now + the job timeout + 1 minute) and `attempts + 1`. Two
  workers never take one job.
- **Finish.** Success sets `done`. An error sets `pending` with `run_after` = now + 30 s ×
  2^(attempts−1) (at most 1 hour), or `failed` once `attempts` reaches `max_attempts`. A
  permanent error (`outbox.Permanent(err)`: a file that is not what it says, a missing source)
  fails at once.
- **Leases.** A `running` job past `lease_until` (its worker died) returns to `pending` on the
  next claim.
- **Handlers are idempotent**: a job may run more than once (a lease that expired while it
  was still working). The vault's jobs write by version id or unique source.
- **Wake-up.** The worker `LISTEN`s on `outbox` and also polls every 10 s.
- **Purge.** The API's upkeep deletes `done` jobs older than 7 days; `failed` jobs stay until
  retried or 90 days.

## Worker (`api -worker`)

- Same binary, same configuration and database role (`ppe_app`). It serves no HTTP but its
  health: `api -healthcheck-worker` checks its heartbeat.
- **Tools.** At start it probes what it can run (`tesseract --version` and its languages,
  `pdftotext -v`, `pdftoppm -v`, later `soffice --version`) and claims only the kinds whose
  tools are there. It writes a **heartbeat** (`outbox.workers`: name, version, tools, kinds,
  `seen_at`) every 30 s.
- **Limits.** `API_WORKER_CONCURRENCY` (1), `API_WORKER_JOB_TIMEOUT` (5 min),
  `API_WORKER_MAX_PAGES` (50). Each job runs in a temp folder of its own, removed after; a
  timeout kills the tool's whole process group.
- **Image `docworker`.** Debian slim with `tesseract-ocr` and `eng`, `lit`, `rus`, `osd`, and
  `poppler-utils`; LibreOffice Writer and fonts in phase 8. Compose service `docworker`:
  `read_only`, tmpfs `/tmp`, `mem_limit` 1g, `cap_drop: [ALL]`, `no-new-privileges`, no ports,
  the same network as the database and the files store. `make prod-build` builds it,
  `make prod-up` starts it and recreates it when its image changed, as `api`.

## Text reading (`vault.extract_text`)

1. Open the version's main file (unsealing it for a sealed type, in memory and the job's temp
   folder only).
2. A PDF: `pdftotext -layout`; when it gives fewer than 50 letters a page, `pdftoppm -r 300`
   and OCR each page (at most `API_WORKER_MAX_PAGES`). An image: OCR.
3. OCR: `tesseract --psm 0` on the first page picks the script; Latin pages read with
   `lit+eng`, Cyrillic with `rus+eng`.
4. For a sealed type, `IndexText` keeps lexemes only, without tokens holding a digit, and
   no text is stored. Otherwise the text is kept (at most 1 MB).
5. `version_text` becomes `read` or `none`, and the document's `search` is rebuilt.

`api -vault-reindex` enqueues reading for every version still `pending` (the rows before the
worker existed, a restore).

## Monitoring

- System gains a **Worker** card (`GET /api/v1/system/worker`, `system.read`): each worker's
  heartbeat, tools and kinds, jobs by kind and state, the oldest waiting, recent failures.
- The Overview lists: no worker seen for 5 minutes while jobs wait; failed jobs in the last 7
  days. `docs/monitoring.md` says what to do for each.
- **Read Again** on a document's version (`…/read-again`) enqueues it once more.

## Tests

- Postgres: two claimers never take the same job; a lease past due returns it; back-off and
  `failed` after `max_attempts`; a permanent error fails at once; the unique live (kind, key);
  the purge.
- A tagged tools test (`go test -tags tools ./internal/vault/extract`), run in CI where
  Tesseract and Poppler are installed: a text PDF, a scanned PDF, a Lithuanian and a Russian
  page.
- e2e: when the tools are on PATH the worker runs as an extra web server and archived documents
  appear; otherwise those steps are skipped.
