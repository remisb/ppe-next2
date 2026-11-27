# Deployment

Moved out of CLAUDE.md on 2026-11-27. Read it before deploying, or before changing `deploy/`,
the Dockerfiles, `docker-compose.prod.yml` or the `prod-*` Make targets.

`docker-compose.prod.yml` (project `ppe-next2-prod`, env file `.env.prod` from
`.env.prod.example`) runs db → migrate (`deploy/migrate.sh`, must match `make migrate`)
→ api (scratch image, `Dockerfile`, tzdata embedded, and a writable `/tmp`: uploads over 1 MiB are parsed through temp files, `TestAPIImageHasTmp`) → caddy (`web/Dockerfile` bakes the
built apps into the Caddy image, the staff app at `WEB_ROOT` served at `/`,
Administration at `ADMIN_ROOT` served at `/admin/`,
App Launcher at `LAUNCHER_ROOT` served at `/apps/`, and Scan SIMs' build at `/srv/build/sim-scan`
for `prod-up` to publish into the `published` volume, which Caddy serves read-only at
`/apps/files/…`; `deploy/Caddyfile`). Only Caddy publishes ports.
Both builds keep their cache between deploys: the API's Go build cache is a BuildKit cache
mount (the modules stay in a layer, so an emptied cache never needs the token), and the web
image runs `pnpm fetch` from the lockfile alone before copying the sources (`web/.dockerignore`
keeps tests and e2e out) and only `vite build`, since CI's web job typechecks.
`make prod-build` ends by trimming Docker's build cache to the newest `PROD_BUILD_CACHE` (6 GB,
`make prod-prune-cache`): an emptied cache (`docker builder prune` without it) makes the next build
compile the API and the backup agent afresh, about ten minutes on the droplet's one CPU (WARE-53).
Caddy retries a connection the API refused for up to 15 s (the `api` snippet), so the API's restart
in a deploy holds requests rather than answering 502.
Caddy also sends the security headers, including a Content-Security-Policy that allows
`index.html`'s inline theme script, the same in every app, by its hash
(every app's `web/apps/<app>/src/csp.test.ts` keeps them in step; rules in `web/AGENTS.md`);
published apps get their profile's policy, the `device` one (Scan SIMs) alone `'wasm-unsafe-eval'`,
`worker-src 'self'` and the camera (ADR 0005; the API sends the page's, Caddy the files').
`.env.prod` needs `API_SIM_CODES_KEY` (`openssl rand -hex 32`, kept offline too: a restore
needs the same key; `docs/backups.md`), or the API does not start. Changing it: the new key with
`API_SIM_CODES_KEY_ID`, the old in `API_SIM_CODES_PREVIOUS_KEYS`, then `make prod-reseal-sim-codes`
(`docs/backups.md` "Changing the SIM codes key").
`make prod-build`, `prod-up`, `prod-down`, `prod-ps`, `prod-logs`, `prod-seed-admin`,
`prod-seed-demo`, `prod-import-sims` (the list on standard input), `prod-backup`, `prod-backups`, `prod-restore`, `prod-drill` (the monthly restore drill into a throwaway database, `deploy/restore-drill.sh`); they run compose under `env -i` so `.env` values cannot leak in.
The `backup` service (dbbackup agent) is built by `deploy/backup.Dockerfile`
(`go install` of dbbackup `DBBACKUP_VERSION`) on `POSTGRES_IMAGE`, the image `db` and
`migrate` also use, so `pg_dump` always matches the server; it backs up to `DBBACKUP_TARGET` (default the `backups`
volume, on the droplet only; `docs/backups.md` sets up a Spaces bucket, encryption,
restore and the major-upgrade steps). The db volume is named by `POSTGRES_VOLUME`
(default `ppe-next2-prod_db-data`, the name compose gave it).
dbbackup and pdf-mini (the assignment form's PDF, `internal/formpdf`) are **private**
repositories: the `api` and `backup` image builds read them with the `github_token` build
secret, the gitignored file `.github-token` (a fine-grained token, read-only on
remisb/dbbackup and remisb/pdf-mini) beside `.env.prod`; CI uses the `DBBACKUP_READ_TOKEN` secret.
Locally, Go fetches it over your own git credentials with `GOPRIVATE=github.com/remisb/*`.
The DigitalOcean droplet serves it at `https://workwear.gavort.nl` (an A record in
gavort.nl's Hostinger DNS; the domain's own website stays at Hostinger) from
`/opt/ppe-next2`, a git checkout of this repository with `.env.prod` (chmod 600, never
committed or printed) beside it. Its Caddy also serves data-sync-ui at `sync.gavort.nl`
(`deploy/sites/sync.caddy`, basic auth). The old `admin.`/`sync.<ip>.sslip.io` addresses
were redirected until 2026-11-22 and no longer answer. Deploy a pushed commit on the droplet:

```bash
cd /opt/ppe-next2 && git pull && make prod-build && make prod-up
```

`prod-up` runs migrations before the API starts and recreates what changed, Caddy last (WARE-53): it
first brings up `db`, `migrate`, `api` and `backup` (`PROD_BEHIND_CADDY`) while the old Caddy keeps
serving and holds requests through the API's restart, recreates `api` or `backup` if compose left it on
the previous image, waits until the API's `GET /ready` answers (database reachable, every migration the
build embeds applied; `internal/db.Migrations`), else fails with the API's log, and only then replaces
`caddy` on its own (about 2 s without connections; certificates live in the `caddy-data` volume), again
when the Caddyfile it runs with (mounted from the checkout, so a change to it alone changes no image)
differs from the checkout's. Recreated with the API, Caddy refused connections from its stop until the
API had started (about 9 s). `db` is recreated only when its config changes. `GET /health` is liveness only. The image's `HEALTHCHECK` runs `/api -healthcheck` (the
binary probes its own `/ready`, as scratch has no curl); Docker shows but never acts on it.
`make prod-build` stamps `git describe` into the binary (`API_COMMIT` → `-X main.commit`),
shown by `/ready` and `make prod-ready`. Every prod service rotates its logs (`x-logging`, 5 × 10 MB).
The uptime check of `https://<site>/ready` and the droplet's CPU/memory/disk alerts (DigitalOcean Insights, formerly Monitoring; memory and disk need `do-agent` on the droplet)
are account settings, described in `docs/monitoring.md`.
The API connects as `ppe_app` once `.env.prod` has `API_DB_USER=ppe_app` and a generated
`API_DB_PASSWORD` (`docs/monitoring.md` has the steps); until then as the owner, and the
Overview warns. After `make prod-restore`, start again with `make prod-up`: the restore drops
grants and `migrate` puts them back.

Accounts need a password, so the first admin is created by a person: set
`API_SEED_USER_EMAIL`/`_PASSWORD` in `.env.prod`, run `make prod-seed-admin`, then blank
the password line. `make prod-seed-demo` needs only the email and refuses a non-empty database.

