# Backups

The database holds everything that cannot be recreated: orders, confirmation evidence,
the audit trail. The `backup` service in `docker-compose.prod.yml` backs it up. It is the
agent from [github.com/remisb/dbbackup](https://github.com/remisb/dbbackup), built on the
same Postgres image as the database. It runs `pg_dump` on a schedule, stores the file,
deletes old ones and records every run in the database. Administrators see the result on
the **Backups** screen. What the screen shows: [specs/backup-service.md](specs/backup-service.md).

## Configuration (`.env.prod`)

| Variable | Default | |
| --- | --- | --- |
| `DBBACKUP_SCHEDULE` | `0 3 * * *` | cron, read in `API_ORG_TIMEZONE` |
| `DBBACKUP_TARGET` | `file:///backups` | the `backups` volume on this server; or `s3://bucket/prefix?endpoint=host&region=r` |
| `DBBACKUP_S3_ACCESS_KEY`, `DBBACKUP_S3_SECRET_KEY` | | for an `s3://` target |
| `DBBACKUP_KEEP_DAYS` / `DBBACKUP_KEEP_LAST` | `14` / `7` | delete backups older than the days, but always keep the newest N |
| `DBBACKUP_ENCRYPT` | (off) | `age:<public key>`: encrypt before storing |
| `DBBACKUP_VERSION` | `v0.1.0` | the dbbackup version `deploy/backup.Dockerfile` installs |
| `POSTGRES_IMAGE` | `postgres:18-alpine` | shared by `db`, `migrate` and `backup` |

After a change: `make prod-build && make prod-up`.

### The GitHub token (dbbackup is a private repository)

The `api` image (Go module download) and the `backup` image (`go install`) fetch
`github.com/remisb/dbbackup` from GitHub. They read a token from the file `.github-token`
next to `.env.prod`, passed to the build as a BuildKit secret, so it never ends up in an
image or a layer:

1. On GitHub: Settings → Developer settings → Fine-grained tokens → Generate. Resource
   owner remisb, repository access "Only select repositories": `remisb/dbbackup`,
   permissions Contents: Read-only. Give it a long expiry and note the date.
2. On the droplet: `install -m 600 /dev/stdin /opt/ppe-next2/.github-token`, paste the
   token, then Ctrl-D.
3. CI: add the same kind of token as the repository secret `DBBACKUP_READ_TOKEN` of
   remisb/ppe-next2.

When the token expires, builds fail at `go mod download` / `go install` with an
authentication error: replace the file (and the CI secret). The running containers are
unaffected. A development machine needs the file only for `make backup-once`. Go itself
uses your own git credentials: `GOPRIVATE=github.com/remisb/*`.

### Off the server: DigitalOcean Spaces

A backup on the droplet is lost with the droplet. Keep them in Spaces, in another region
than the droplet (the droplet is in ams3, so use fra1, for example):

1. In the DigitalOcean control panel, create a Spaces bucket (private, file listing off) in fra1,
   e.g. `ppe-next2-backups`. Spaces costs $5 a month, with 250 GiB included.
2. Under API → Spaces Keys, create a key limited to that bucket (read/write).
3. In `.env.prod`:
   ```
   DBBACKUP_TARGET=s3://ppe-next2-backups/prod?endpoint=fra1.digitaloceanspaces.com&region=fra1
   DBBACKUP_S3_ACCESS_KEY=...
   DBBACKUP_S3_SECRET_KEY=...
   ```
4. `make prod-build && make prod-up && make prod-backup`, then check Administration → System → Backups.

### Encryption (optional)

On your own computer: `age-keygen -o ppe-backup.key` prints `Public key: age1...`. Put
`DBBACKUP_ENCRYPT=age:age1...` in `.env.prod`. Keep `ppe-backup.key` off the server, in a
password manager or on a USB key. It is needed only to restore. Without it the encrypted
backups cannot be read.

## Commands (on the droplet, in `/opt/ppe-next2`)

```bash
make prod-backup                    # back up now
make prod-backups                   # list stored backups, newest first
make prod-restore                   # names the newest backup and stops
make prod-restore CONFIRM=yes       # restores the newest backup
make prod-restore KEY=<key> IDENTITY=/root/ppe-backup.key CONFIRM=yes   # a chosen, encrypted one
make prod-logs                      # the agent logs each run
```

A restore replaces the database's contents in one transaction (a failed restore changes
nothing). Stop the API first (`docker compose ... stop api`, or accept that requests
during the restore may fail), and start it again afterwards. The backup history is in the
database too, so after a restore it ends at the restored backup.

## Restore drill (monthly)

A backup that was never restored is not known to work. On a temporary droplet or your
computer, with Docker:

```bash
docker run -d --name drill -e POSTGRES_PASSWORD=drill -p 55432:5432 postgres:18-alpine
git clone git@github.com:remisb/dbbackup.git && docker build --build-arg POSTGRES_IMAGE=postgres:18-alpine -t dbbackup dbbackup
docker run --rm --network host -e DBBACKUP_DSN='postgres://postgres:drill@localhost:55432/postgres?sslmode=disable' \
  -e DBBACKUP_RECORD=false -e DBBACKUP_TARGET='s3://ppe-next2-backups/prod?endpoint=fra1.digitaloceanspaces.com&region=fra1' \
  -e DBBACKUP_S3_ACCESS_KEY=... -e DBBACKUP_S3_SECRET_KEY=... dbbackup restore --yes --latest
```

Then check the row counts (orders, employees) in the drill database.

## Upgrading Postgres to a new major version

Minor versions (18.x) need nothing but `make prod-build && make prod-up`. A major version
cannot open the old data directory, so it is a backup and restore into a new volume:

1. `make prod-backup`, and note the key from `make prod-backups`.
2. `make prod-down`.
3. In `.env.prod`: `POSTGRES_IMAGE=postgres:19-alpine` and
   `POSTGRES_VOLUME=ppe-next2-prod_db-data-19`. The old volume stays, for rollback.
4. `make prod-build`. This also rebuilds the backup image on 19 (it needs `.github-token`).
5. Start the database alone, then restore into it:
   `env -i PATH="$PATH" docker compose -f docker-compose.prod.yml --env-file .env.prod up -d db`,
   then `make prod-restore CONFIRM=yes`.
6. `make prod-up`. `migrate` finds its bookkeeping restored and applies nothing new.
7. Check the app and System's Backups tab. Rolling back means restoring the two old values
   in `.env.prod` and `make prod-up`.

If step 4 is forgotten, the agent refuses to run an older `pg_dump` against the newer
server. The failed run, with that reason, shows on System's Backups tab.

## Costs (DigitalOcean, October 2026, before VAT)

| | per month |
| --- | --- |
| Droplet, Basic 2 GB (already running) | $12.00 |
| Spaces bucket (250 GiB, 1 TiB transfer included) | $5.00 |
| Optional: weekly Droplet Backups (whole disk, also keeps `.env.prod` and certificates) | $2.40 |
| **Total with Spaces** | **$17.00** ($19.40 with Droplet Backups) |

The backup agent needs no bigger droplet: it idles at a few MB of memory and a dump of
this database takes seconds.
